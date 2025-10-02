const _ = require('lodash');
const { Aggregator } = require('mingo/aggregator');
const RuleGroup = require('./rule_group');
const { useOperators, OperatorType } = require('mingo/core');
const { $match, $group, $sort } = require('mingo/operators/pipeline');
const { $min, $max } = require('mingo/operators/accumulator');
const RuleEngineError = require('../../errors/rule_engine_error');
useOperators(OperatorType.PIPELINE, { $match, $group, $sort });
useOperators(OperatorType.ACCUMULATOR, { $min, $max });

/**
 * @typedef {import("../../lib/objection_models/PaymentConfiguration")} PaymentConfiguration
 */

// rules, selection strategy, payment_configurations
async function filterPaymentConfigurations(paymentConfigurations, reports) {
  return paymentConfigurations.filter((paymentConfiguration) => {
    let processorSummary = _.filter(reports, { processor_id: paymentConfiguration.processor_id });

    // REVIEW: This shouldn't happen, but in case it does, we'll include this payment configuration
    if (!processorSummary) {
      return true;
    }

    // REVIEW: if missing rules, should we return false?
    let configuration = paymentConfiguration?.configuration?.rules;
    if (!configuration) {
      return true;
    }

    // REVIEW: should we rename rules to rule or rule_group in the data?
    let ruleGroup = new RuleGroup(configuration);

    // if any of the ranges pass, include this payment configuration in the possible candidates
    return ruleGroup.test(processorSummary);
  });
}

// TODO: update where the weights come from.
// should be a map of weights configured on the payment strategy
function weightStrategy(paymentConfigurations, reports, paymentGroup) {
  let { select_configuration_strategy } = paymentGroup.configuration;
  let { weights } = select_configuration_strategy;
  let pcIds = _.map(paymentConfigurations, 'id');

  // NOTE: this is the original shape of the payment configuration weigts
  // let weightShape = { payment_configuration_id, weight };
  // we'll munge this data to look like this shape until I get a chance to refactor the strategy
  let mungedPcWeights = _.map(weights, (weight, payment_configuration_id) => {
    return {
      payment_configuration_id,
      weight,
    };
  });

  let availablePaymentConfigurationWeights = _.filter(mungedPcWeights, (pc_weight) => {
    return pcIds.includes(pc_weight.payment_configuration_id);
  });

  // prepare cumulative weights
  let cumulativeWeights = _.map(availablePaymentConfigurationWeights, (pc_weight, index, list) => {
    return _.sumBy(_.slice(list, 0, index + 1), 'weight');
  });

  // generate a random number based on the cumulative weight
  const randomNumber = _.last(cumulativeWeights) * Math.random();

  let weightIndex = _.findIndex(cumulativeWeights, (weight) => {
    return weight >= randomNumber;
  });
  let selectedPaymentConfigurationWeight = availablePaymentConfigurationWeights[weightIndex];

  return _.find(paymentConfigurations, {
    id: selectedPaymentConfigurationWeight.payment_configuration_id,
  });
}

// TODO: use named strategies with pre-defined aggregation commands

/**
 * aggregationStrategy
 * reduces the list of payment configurations to a single one using mingojs aggregation
 * If there are multiple payment configurations returned, only the head is used
 * this supports $sort aggregations
 *
 * @param {PaymentConfiguration[]} paymentConfigurations - a list of available payment configurations, should already be filtered
 * @param {Object[]} reports - the processor reports
 * @param {Object[]} aggregationSteps - mingo aggregation steps
 * @returns {PaymentConfiguration} - the selected payment configuration
 */
function aggregationStrategy(paymentConfigurations, reports, aggregationSteps) {
  let result;
  // we wrap in a try/catch in case there is an error in the aggregation steps
  // and can still recover from it
  try {
    let agg = new Aggregator([
      // since the reports have not been filtered to only include the processors of the eligible payment configurations,
      // we need to filter them here
      { $match: { processor_id: { $in: _.map(paymentConfigurations, 'processor_id') } } },
      // NOTE: this is a standard mingo aggregation pipeline operation
      // https://github.com/kofrasa/mingo#aggregation-pipeline
      // https://www.mongodb.com/docs/manual/core/aggregation-pipeline/
      // pulled from the payment_groups.configuration in the db
      ...aggregationSteps,
      { $limit: 1 },
    ]);

    [result] = agg.run(reports);
  } catch (error) {
    throw new RuleEngineError(error, { error }, 'AGGREGATION_ERROR');
  }

  // reduce the result to the intersection of the payment configurations and the reports by processor_id
  let eligiblePaymentConfigurations = _.filter(paymentConfigurations, {
    processor_id: result.processor_id,
  });

  if (_.isEmpty(eligiblePaymentConfigurations)) {
    throw new RuleEngineError(
      `No eligible payment configurations found`,
      {},
      'NO_PAYMENT_CONFIGURATION_SELECTION_STRATEGY'
    );
  }

  // if we end up with more than one payment configuration, return a random one
  // multiple payment configurations are possible if the aggregation strategy is not deterministic
  // or if there are multiple payment configurations using the same processor that was chosen
  return _.sample(eligiblePaymentConfigurations);
}

/**
 * selectOnePaymentConfiguration
 * reduces the list of payment configurations to a single one
 *
 * @param {{PaymentConfiguration}[]} paymentConfigurations
 * @param {Object[]} reports
 * @param {object} strategy
 * @param {'weight'|'aggregation'|'round_robin'|'least'|'most'} strategy.type - the type of deterministic strategy used to filter to one
 * @returns {PaymentConfiguration} - a single payment configuration
 */
function selectOnePaymentConfiguration(paymentConfigurations, reports, paymentGroup) {
  let { select_configuration_strategy } = paymentGroup.configuration;

  switch (select_configuration_strategy?.type) {
    case 'weight':
      return weightStrategy(paymentConfigurations, reports, paymentGroup);

    case 'aggregation':
      return aggregationStrategy(
        paymentConfigurations,
        reports,
        select_configuration_strategy.aggregate_steps
      );

    case 'most':
      return aggregationStrategy(paymentConfigurations, reports, [
        { $match: { range: select_configuration_strategy.range } },
        { $sort: { [select_configuration_strategy.sort_column]: -1 } },
      ]);

    case 'least':
      return aggregationStrategy(paymentConfigurations, reports, [
        { $match: { range: select_configuration_strategy.range } },
        { $sort: { [select_configuration_strategy.sort_column]: 1 } },
      ]);

    case 'round_robin':
      return aggregationStrategy(paymentConfigurations, reports, [
        { $match: { range: select_configuration_strategy.range } },
        { $sort: { latest_payment_transaction_created_at: 1 } },
      ]);

    default:
      throw new RuleEngineError(
        `unknown payment group strategy type: ${select_configuration_strategy.type}`
      );
  }
}

module.exports = { filterPaymentConfigurations, selectOnePaymentConfiguration };

/* samples for easy reference
 * payment_groups.configuration ()
 * how this is stored in the db
 *
let payment_groups_configuration = {
  select_configuration_strategy: {
    type: 'aggregation',
    aggregate_steps: [
      {
        $sort: {
          last_payment_transaction_created_at: -1,
        },
      },
    ],
  },
};
 */
