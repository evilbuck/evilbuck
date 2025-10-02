const { assign } = require('xstate');
const { v4: uuid } = require('uuid');

const { GeneralError } = require('@feathersjs/errors');
const PostgresLog = require('./logging/postgresql_log');
const logError = require('./logging/xstate_error_logger');

const log = new PostgresLog('flow');

// TODO@logging: refactor this to use a common error logger or factory
/**
 * handleError
 * the error handler for Flows.
 * maps the low level error and returns a public facing error with details
 * @param {object} ctx
 * @param {object} event
 *
 * @returns {object} - returns an object with `error` as a property
 */
const handleError = async (ctx, event) => {
  if (!event.data) {
    return {
      error: new GeneralError('No real error found, but the error state was triggered :('),
      id: ctx.id,
    };
  }
  const error = event.data;
  let logData = {
    event_type: event.type,
    event_data: JSON.stringify(event.data),
    type: 'flow',
  };
  logError(error, { name: 'State Machine Error State', logData });

  const { id } = ctx;

  return { error, id };
};

const finalErrorAssignment = assign((__, event) => {
  return { error: event.data.error };
});

const assignId = assign(() => {
  return { id: uuid() };
});

const logContext = assign((ctx, event) => {
  log.write({ id: ctx.id, event, ctx });
});

const extendContext = assign(function extendContext(__, event) {
  return { ...event.data };
});

const assignAdapter = assign({
  adapter: (ctx, event) => {
    return event.data;
  },
});

const assignCampaignAndProcessors = assign((ctx, event) => {
  const campaign = event.data;
  let { processors } = campaign;
  if (ctx.processors) {
    processors = processors.concat(processors);
  }

  return { campaign, processors };
});

const assignProcessor = assign({
  processor: (ctx, event) => event.data,
});

module.exports = {
  assignAdapter,
  assignCampaignAndProcessors,
  assignId,
  assignProcessor,
  extendContext,
  finalErrorAssignment,
  handleError,
  logContext,
};
