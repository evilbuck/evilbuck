const _ = require('lodash');
const moment = require('moment');
const { BadRequest } = require('@feathersjs/errors');
const OverhubTransactionError = require('../../../lib/errors/overhub_transaction_error');
const PaymentTransactionBase = require('../../payment_transaction_base.class');
const { createAdapter } = require('../../../plugins/payment');
const OverhubResponse = require('../../../plugins/payment/OverhubResponse');
const { PaymentSource2, PaymentTransaction, Store } = require('../../../lib/objection_models');
const {
  filterPaymentConfigurations,
  selectOnePaymentConfiguration,
} = require('../../../lib/rule_engine/lib/processor_rules_engine.controller');
const LegacyPaymentProcessorDecorator = require('../../../lib/models/payment_processor');
const RuleEngineError = require('../../../lib/errors/rule_engine_error');
const Sentry = require('../../../lib/logging/sentry.factory')();

/**
 * @typedef {import('@feathersjs/feathers').Params} Params
 */

/**
 * @typedef {{import('../../../plugins/payment/payment_payload')}} PaymentPayload
 */

/**
 * CapturesService
 */
class CapturesService extends PaymentTransactionBase {
  /**
   * creates a new charge process transaction
   * before hooks:
   * - attachParentTransactionMaybe - sets data.parentTransaction & data.processorType if paypal
   * - getOrderPaymentSource - context.data.paymentToken if data.order.id is present and order.payment_source_id is present
   * - validateReqBody - joi
   * - encryptSensitiveHook
   * - validatePaymentSource - validates the paymentToken; is it valid, should we attempt to capture it?
   * - initTransaction
   * - initPayload - initializes PaymentPayload to params.payload
   * - initializePaymentGroup - sets params.payload.paymentGroupId or params.payload.parentTransaction
   * - selectProcessor - mutates params.processor
   *
   * after hooks:
   * - legacyFormatter - mutates the context.dispatch to format the data.
   * - updatePaymentTransaction - updates the payment transaction
   *
   * @param {PayloadData} data
   * @param {{import('@feathers/feathers').Params}} params
   * @param {PaymentPayload} params.payload - the payment payload for the adapter
   * @returns {import("../../../plugins/payment/OverhubResponse")} - the overhub payment gateway response
   */
  async create(data, params) {
    let { payload, payment_transaction } = params;

    // check if there is a processor
    // if not, build the OverhubResponse and attach an error
    try {
      let paymentConfiguration = await this._selectPaymentConfiguration(
        data.payment_group_id,
        data.store_id
      );
      payload.payment_configuration = paymentConfiguration;
      // NOTE: this is accessed in an after hook
      params.payment_configuration = paymentConfiguration;
      let processor = await paymentConfiguration.$relatedQuery('processor');
      // TODO: once we refactor everything past this point in the stack to use a PaymentConfiguration
      // instead of a PaymentProcessor, we can remove this
      processor = new LegacyPaymentProcessorDecorator(
        await paymentConfiguration.$relatedQuery('processor')
      );
      // NOTE: this is accessed in an after hook
      params.processor = processor;

      const AdapterClass = createAdapter(processor.type);
      // NOTE: This will throw if the payment source is not valid
      await this._validatePaymentSource(data, params);

      const adapter = new AdapterClass(payload, {
        credentials: processor.getCredentials(),
        paymentSourceService: this.app.service('/payment_sources'),
        processor,
        // NOTE: only used for testing declines in sandbox account in NMI
        force_decline: data?.test?.force_decline ?? false,
      });

      let result = await adapter.capture();
      result.id = params.payment_transaction.id;
      result.processor = processor;

      let patchData = {
        processor_transaction_id: result.processorTransactionId,
        is_sandbox: processor.data.is_sandbox,
      };

      // The adapters will always return an OverhubResponse, if there was an error, it is attached to the response.error
      // we capture the error reason and code and patch the payment_transaction
      // TODO: normalize the error codes and reasons across all adapters
      let { error } = result;
      if (_.isObject(error?.data)) {
        let { vendor_error_code, vendor_error_reason } = error.data;
        patchData.vendor_error_code = vendor_error_code;
        patchData.vendor_error_reason = vendor_error_reason;
      }

      await payment_transaction.$query().patch(patchData);

      return result;
    } catch (error) {
      // the payment source is not valid, proceed with rejection cleanup
      // for the payment transaction and building the OverhubResponse
      // if this was an expected rejection, then we update the associated payment transaction and fx rates
      // and return the OverhubResponse with the rejection error and data
      // otherwise, we throw the error
      if (
        _.includes(
          ['PAYMENT_SOURCE_REJECTED', 'PAYMENT_TOKEN_REQUIRED', 'PAYMENT_SOURCE_NOT_FOUND'],
          error?.data?.rejection_code
        )
      ) {
        // Expected rejection, update the payment transaction and fx rates
        return this._handlePaymentSourceError(error, params);
      } else if (error instanceof RuleEngineError) {
        return this._handleRuleEngineError(error, params);
      } else {
        return this._handleUnknownError(error, params);
      }
    }
  }

  /**
   * _handleUnknownError
   * formats the error into an OverhubResponse and patches the payment transaction with the appropriate data so it's not broken
   *
   * @param {Error} error
   * @param {Params} params - the params object from the service
   * @param {PaymentTransaction} params.payment_transaction - the overhub payment transaction that was attempted
   * @param {PaymentPayload} params.payload - the payment payload for the adapter
   * @returns {OverhubResponse}
   */
  async _handleUnknownError(error, params) {
    let { payload, payment_configuration, payment_transaction } = params;
    let processorType = 'NO-PROCESSOR';
    if (payment_configuration) {
      let processor = await payment_configuration.$relatedQuery('processor');
      processorType = processor.type;
    }
    let response = new OverhubResponse(processorType, 'capture', { payload });
    response.error = error;
    response.status = 'error';

    await PaymentTransaction.query()
      .findById(payment_transaction.id)
      .patch({
        overhub_response: response,
        // NOTE: error.data will likely not exist, but in case it does, we want to capture the status, code and reason
        status: error?.data?.status ?? 'error',
        error_code: error?.data?.error_code ?? 'UNKNOWN',
        error_reason: error?.data?.error_reason ?? error.message,
      });

    return response;
  }

  /**
   * handlePaymentSourceError
   * Updates the payment_transaction with the rejection_code and rejection_reason
   *
   * @param {BadRequest} error - BadRequest error
   * @param {Params} params - the params object from the service
   */
  async _handlePaymentSourceError(error, params) {
    let { parent_transaction, payment_configuration, payment_transaction, payload, processor } = params;

    let response = new OverhubResponse(processor.type, 'capture', payload);
    let { rejection_code, rejection_reason } = error.data;
    response.error = error;
    response.status = 'rejected';
    let payment_configuration_id =
      payment_configuration?.id ?? parent_transaction?.payment_configuration_id;

    // REVIEW: We need to find out what condition exists for this branch to be true
    if (!payment_configuration_id) {
      Sentry.captureMessage(
        `A payment configuration was not found for the payment transaction ${payment_transaction.id}`,
        {
          extra: {
            payment_transaction_id: payment_transaction?.id,
            payment_payload: payload,
            processor,
            parent_transaction,
          },
        }
      );
    }

    await PaymentTransaction.query().findById(payment_transaction.id).patch({
      overhub_response: response,
      status: 'rejected',
      processor_type: processor.type,
      payment_configuration_id,
      rejection_code,
      rejection_reason,
    });

    return response;
  }

  /**
   * validatePaymentSource
   * validates the payment source provided was not declined in the last 24 hours
   *
   * @param {object} data - the data object from the service
   * @param {string} data.paymentToken - the payment token to validate
   * @param {Params} params - the params object from the service
   * @param {import("../../lib/objection_models").User} params.users - the authenticated user/agent object from the jwt
   * @throws {BadRequest} - if the payment source was declined in the last x minutes or the payment source is not valid
   */
  async _validatePaymentSource(data, params) {
    // verify that this payment source hasn't been declined within the specified time
    let { paymentToken } = data;
    let { users: agent } = params;

    if (!paymentToken) {
      throw new BadRequest(`Payment Token is required`, {
        error_code: 'PAYMENT_TOKEN_REQUIRED',
        error_reason: 'A payment token was not provided',
      });
    }

    // TODO: once the payment source is refactored to utilize a different hashing algorithm and it is not the primary key,
    // we need to change this to scope the query by the token and the account
    let paymentSource = await PaymentSource2.query().findById(paymentToken);
    if (!paymentSource) {
      throw new BadRequest(`Payment Token could not be found`, {
        error_code: `PAYMENT_SOURCE_NOT_FOUND`,
        error_reason: `The payment source could not be found with the provided token ${paymentToken}`,
      });
    }

    // if the payment is marked as a test, then don't look for a previous decline
    // and just attempt to capture the payment
    if (data.is_test) {
      return true;
    }

    let account = await agent.$relatedQuery('account');
    let declineRetryTime = await account.$getDeclineRetryTime();

    // check if the payment source has been declined previously within the specified time
    // so we don't hit the gateway
    let declinedPaymentTransaction = await paymentSource
      .$relatedQuery('payment_transactions')
      .findOne({
        status: 'declined',
        account_id: agent.account_id,
      })
      .andWhere('created_at', '>', moment().subtract(declineRetryTime, 'minutes').toDate());

    if (declinedPaymentTransaction) {
      throw new OverhubTransactionError(
        `Payment Source has been declined`,
        {
          rejection_code: `PAYMENT_SOURCE_REJECTED`,
          rejection_reason: `The payment source provided was recently declined. This could be a duplicate attempt to process a bad card`,
        },
        'rejected',
        'rejected'
      );
    }
  }

  /**
   * _selectPaymentConfiguration
   * the rules engine can go here for selecting a processor.
   *
   * @param {string} context.data.store_id - intended store id to make the payment against
   * @param {string} context.data.payment_group_id - the slug to use to find the payment group
   */
  async _selectPaymentConfiguration(payment_group_id, store_id) {
    let paymentGroup = await Store.relatedQuery('payment_groups')
      .for(store_id)
      .where({ slug: payment_group_id })
      .findOne({});

    // create the processor report for evaluation by the rules engine
    let processorReport = await this.app
      .service('reports/processor_summary')
      .create({ paymentGroupId: paymentGroup.id });

    // DOCS: Unless the results of a service are returned to the client,
    // feathers will not call toJSON on the returned object. We need to
    // ensure that we are passing pojos to the rules engine.
    processorReport = processorReport.map((r) => r.toJSON());

    let paymentConfigurations = await paymentGroup.$relatedQuery('payment_configurations');

    // Run the processor report through the rules engine
    let filteredProcessors = await filterPaymentConfigurations(paymentConfigurations, processorReport);

    if (filteredProcessors.length === 0) {
      throw new RuleEngineError(
        'No processors found for payment group after rules engine filtering',
        {},
        'RULES_ELIMINATED_ALL_PROCESSORS'
      );
    }

    // if there are multiple processors, we need to select one
    // using the rules on the payment group
    let selectedPaymentConfiguration = selectOnePaymentConfiguration(
      filteredProcessors,
      processorReport,
      paymentGroup
    );

    return selectedPaymentConfiguration;
  }

  async _handleRuleEngineError(error, params) {
    let { payload, payment_transaction } = params;
    // build up the overhub response with the error
    let response = new OverhubResponse('NO-PROCESSOR', 'capture', { payload });
    response.error = error;
    response.status = 'rejected';

    await PaymentTransaction.query().findById(payment_transaction.id).patch({
      overhub_response: response,
      rejection_code: error?.data?.rejection_code,
      rejection_reason: error?.data?.rejection_reason,
      status: 'rejected',
    });

    return response;
  }
}

module.exports = CapturesService;
