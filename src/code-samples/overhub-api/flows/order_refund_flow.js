const { createMachine, send, assign } = require('xstate');
const { handleError } = require('../lib/flow_actions');
const { v4: uuid } = require('uuid');
const { parseCurrency } = require('../lib/helpers');
const _ = require('lodash');

module.exports = function createOrderRefundFlow() {
  return createMachine(
    {
      id: 'order-refund',
      initial: 'new',
      context: {},
      states: {
        new: {
          on: {
            REFUND: 'select_transaction',
          },
        },

        select_transaction: {
          id: 'select-payment-transaction',
          invoke: {
            // NOTE: selectTransaction takes the highest transaction amount available
            src: 'selectTransaction',

            onDone: {
              target: 'refund',
              actions: [
                assign({
                  activeTransaction: (ctx, event) => {
                    return event.data;
                  },
                  // remove the transaction that was just refunded from the available transactions
                  // in case there are more refunds that are needed
                  paymentTransactions: (ctx, event) => {
                    return ctx.paymentTransactions.filter((t) => t !== event.data);
                  },
                }),
              ],
            },
          },
        },

        // before this, a payment_transaction must be chosen to work with
        refund: {
          id: 'refund',
          invoke: {
            src: 'refundTransaction',
            onDone: {
              actions: ['determineRefundState', 'appendPaymentTransaction'],
            },

            onError: {
              target: 'error',
            },
          },

          on: {
            REFUND: 'select_transaction',
            COMPLETE: 'complete',
          },
        },

        error: {
          invoke: {
            id: 'order-refund-error',
            src: 'handleError',
            onDone: {
              target: 'complete',
              actions: assign({
                error: (ctx, event) => {
                  return event.data.error;
                },
              }),
            },
          },
        },

        complete: {
          type: 'final',
          data: (ctx) => {
            return { transactions: ctx.transactions || [], error: ctx.error };
          },
        },
      },
    },
    {
      services: {
        handleError,

        // simple algo to select highest remaining balance. Could use something different here.
        selectTransaction: async (ctx) => {
          // NOTE: this works for the order_item strategy too since order doesn't matter
          // sorts by highest available amount, then select that one.
          return ctx.paymentTransactions.sort((a, b) => b.balance - a.balance)[0];
        },

        refundTransaction: async (ctx) => {
          let { activeTransaction, refund_plan, strategy } = ctx;

          let currentRefundAmount = 0;
          let amountLeftToRefund = ctx.amountLeftToRefund || ctx.refundAmountRequested;

          // this is a little backwards. We should be refunding strictly from the refund_plan instead of selecting from the transactions
          // though this will require a bit more refactoring to make it work.
          // for now, we only pass in the payment transactions that are necessary and reduce through them onnly using the refund_plan
          // to determine the amount to refund.
          if (strategy === 'order_items' && activeTransaction) {
            currentRefundAmount = _.find(refund_plan, {
              payment_transaction_id: activeTransaction.id,
            }).amount;
          } else if (activeTransaction.balance >= amountLeftToRefund) {
            currentRefundAmount = amountLeftToRefund;
          } else {
            currentRefundAmount = activeTransaction.balance;
          }

          // send refund request to /payments/refunds service
          let refundResult = await ctx.fn
            .getApp()
            .service('/payments/refund')
            .create(
              {
                parent_id: activeTransaction.id, // the original capture to refund
                idempotent_key: `${ctx.orderId}-${uuid()}`,
                amount: currentRefundAmount,
                order_transaction_id: ctx.orderTransaction.id,
                currency: ctx.order.currency_iso,
                ip_address: ctx.ip_address,
              },
              ctx.commonParams // essentially just enough to authenticate and authorize via the standard service hooks
            );

          // REVIEW@refunds: Not sure if this is the best way to handle it, but
          // for now I am just going to throw an error here if the refund
          // service returns one, since the current logic seems to just proceed.
          if (refundResult instanceof Error) {
            throw refundResult;
          }

          amountLeftToRefund = parseCurrency(amountLeftToRefund - refundResult.data.amount);

          return { amountLeftToRefund, result: refundResult };
        },
      },

      actions: {
        appendPaymentTransaction: assign({
          transactions: (ctx, event) => {
            return (ctx.transactions || []).concat({
              parent_id: ctx.activeTransaction.id,
              ...event.data.result,
            });
          },
        }),

        determineRefundState: send((ctx, event) => {
          if (ctx.strategy === 'order_items') {
            // check if there are more payment transactions left in the context
            // minus this current one
            if (ctx.paymentTransactions.length > 0) {
              return 'REFUND';
            }
          } else {
            if (event.data.amountLeftToRefund > 0) {
              ctx.amountLeftToRefund = event.data.amountLeftToRefund;
              return 'REFUND';
            }
          }

          return 'COMPLETE';
        }),
      },
    }
  );
};
