const _ = require('lodash');

const BaseRestService = require('../base_rest_service');
const OrderDecorator = require('../../lib/models/order.decorator');
const { pickCommonParams } = require('../service_common.helpers');
const { Contact, Customer, Order, OrderItem } = require('../../lib/objection_models');
const { BadRequest } = require('@feathersjs/errors');

// NOTE@order-decorator: Marked for later refactoring.

/**
 * getRequestIpAddress
 * picks the correct default ip address based on the request
 *
 * @param {{import('@feathersjs/feathers).HookContext.data}} data - data object passed into mutating feathers service methods
 * @param {{import('@feathersjs/feathers').Params}} params - params object passed to all feathers service methods
 * @returns {string} - ip address
 */
function getRequestIpAddress(data, params) {
  return data.ip_address ?? params.ip_address;
}

class Orders extends BaseRestService {
  async get(id) {
    let order = await Order.query().findById(id);
    return { data: { order } };
  }

  // REVIEW: this could be optimized if it becomes a pain point
  async find(params) {
    let { query } = params;
    let possibleContacts;
    let commonParams = _.pick(params, 'users', 'knex');

    let newQuery = _.omit(query, 'email');

    // REVIEW: I believe this is only required for an admin interface. If it is, refactor to an admin route and move on.
    // build out the query this way instead of a join to try and maintain the common query interface
    // if email exists, search through contacts
    // TODO: this should be refactored to only return the contacts when requested
    // this requires refactoring calling code though.
    if (query?.email) {
      possibleContacts = await Contact.query().where('email', 'ilike', `${query.email}%`);
    }

    if (possibleContacts) {
      newQuery.$or = [
        { shipping_contact_id: { $in: possibleContacts.map((contact) => contact.id) } },
        { billing_contact_id: { $in: possibleContacts.map((contact) => contact.id) } },
      ];
    }

    let orders = await this.app.service('/orders_base').find({ ...commonParams, query: newQuery });

    let orderTransactions = await this.app.service('/order_transactions').find({
      ...commonParams,
      query: {
        order_id: {
          $in: _.map(orders, 'id'),
        },
      },
    });

    // let's pregroup the transactions for O(n) instead of O(n^2)
    let groupedOrderTransactions = orderTransactions.reduce((memo, orderTransaction) => {
      let { order_id } = orderTransaction;
      if (!memo[order_id]) {
        memo[order_id] = [];
      }
      memo[order_id].push(
        _.pick(orderTransaction, 'id', 'order_id', 'session_id', 'api_application_id', 'req')
      );

      return memo;
    }, {});

    for (let order of orders) {
      order.contact = _.find(
        possibleContacts,
        (contact) => contact.id === order.billing_contact_id || contact.id === order.shipping_contact_id
      );
      order.orderTransactions = groupedOrderTransactions[order.id];
    }

    return orders;
  }

  async patch(id, data, params) {
    let { intent } = data;
    data.id = id;

    const ordersBaseService = this.app.service('private/orders_base');

    // FIXME: DRY this up. There are several places in which I must add properties to a whitelist in order to save it. SMH
    let orderData = _.pick(
      data,
      'billing_contact_id',
      'shipping_contact_id',
      'session_id',
      'currency_iso',
      'sales_tax',
      'id',
      'customer_id',
      'tax_is_included'
    );

    orderData.payment_source_id = data.paymentToken;
    orderData.account_id = data.accountId;

    let order = new OrderDecorator(orderData);

    order.order_items = params.order_items;

    // REVIEW: why is this needed? It is needed, because the order_total_amount doesn't properly calculate
    // without this block of code. Need to find out what is being provided by the patch to avoid an
    // unnecessary db call

    // REVIEW@order-items: I'm fairly certain we don't need to patch the base
    // order at this point. I think attaching the order_items to the order and
    // exporting should give us the correct order calculations. Looks like this
    // may just be copy-pasta.
    let orderExport = await order.export();
    let baseOrder = await ordersBaseService.patch(
      order.id,
      _.omit(orderExport, 'id', 'created_at', 'updated_at', 'order_items')
    );
    await order.refresh(baseOrder);

    let captureResult = {};
    const captureParams = pickCommonParams(params);
    const captureData = {
      amount: await order.getOutstandingBalance(),
      currency: order.currency_iso,
      idempotent_key: data.idempotent_key,
      is_test: order.is_test,
      order_transaction_id: data.orderTransaction.id,
      order: _.pick(order, ['id', 'slug']),
      payment_group_id: data.payment_group_id,
      paymentToken: data.paymentToken,
      store_id: data.store_id,
    };

    // look for an existing contact on the order, otherwise use the contact from the service call data
    captureData.billing_contact = await baseOrder.$relatedQuery('billing_contact');
    if (!captureData.billing_contact && data.billing_contact_id) {
      captureData.billing_contact = await Contact.query().findById(data.billing_contact_id);
    }

    // look for an existing contact on the order, otherwise use the contact from the service call data
    captureData.shipping_contact = await baseOrder.$relatedQuery('shipping_contact');
    if (!captureData.shipping_contact && data.shipping_contact_id) {
      captureData.shipping_contact = await Contact.query().findById(data.shipping_contact_id);
    }

    // look for an existing customer on the order, otherwise use the contact from the service call data
    captureData.customer = await baseOrder.$relatedQuery('customer');
    if (!captureData.customer && data.customer_id) {
      let customer = await Customer.query().findById(data.customer_id);
      captureData.customer = customer;
    }

    captureData.ip_address = getRequestIpAddress(data, params);

    // Make the underlying processor call when an intent is available
    switch (intent) {
      case 'capture': {
        // TODO@capture: refactor this so this payment transaction is only fetched when there is not a
        // payment group id passed in. This is only to support using the last payment group id if there is not an override
        // also look at the upsell flag here
        let paymentTransactions = await Order.relatedQuery('payment_transactions')
          .for(order.id)
          .where({ status: 'approved', type: 'process' })
          .orderBy('created_at', 'desc');
        let lastPaymentTransaction = _.first(paymentTransactions);
        // look for payment group id override
        if (!data.payment_group_id) {
          // get the last successful payment group id
          captureData.parent_id = lastPaymentTransaction.id;
        }

        if (!_.isEmpty(paymentTransactions)) {
          captureData.upsell = true;
        }

        // Run capture through the capture flow
        captureResult = await this.app.service('/payments/capture').create(captureData, captureParams);
        params.shouldClose = true;
        params.payment_transaction_id = captureResult.id;

        // post sale declined transaction order items
        if (captureResult.status === 'declined' && params.is_post_sale) {
          // only soft delete the new items that were used during the upsell
          // params.new_order_items is set in the orders.hooks.js buildAndMutateOrderItems hook
          await OrderItem.query().findByIds(_.map(params.new_order_items, 'id')).patch({
            is_funded: false,
            is_removed: true,
            'meta:is_archived': true, // Archived items are omitted from funding calculations
            'meta:declined_transaction_id': captureResult.id, // Storing this for reference
          });
        }

        // NOTE@capture: eventType is used in order_versions.service
        /**
         * eventType
         * signals to the order version service what type of event triggered the close
         * helps with firing the correct events in the order lifecycle
         */
        params.eventType = 'capture';

        // update the cached totals
        let patchData = _.omit(
          await order.export(true),
          'id',
          'created_at',
          'updated_at',
          'order_items',
          'payment_transactions'
        );

        // TODO@objection: tried switching to objection queries, but had some other issues - ye be warned
        // await Order.query().findById(order.id).patch(patchData);
        // baseOrder = Order.query().findById(order.id);
        baseOrder = await ordersBaseService.patch(order.id, patchData, params);
        await order.refresh();

        break;
      }

      // REVIEW: maybe this should be the default?
      case 'build':
        break;

      case 'authorize':
        captureResult = await this.app.service('/payments/authorize').create(captureData, captureParams);

        break;

      default:
        throw new BadRequest('Not expecting an unknown intent');
    }

    // FIXME@order-model: We are setting this to null so that the Order
    // decorator can fetch an updated set of payment_transactions. Moving
    // away from the decorator will allow us to simply refetch the order
    // and its associations.
    order.payment_transactions = null;

    const responseData = {
      data: {
        orderTransactionId: data.orderTransaction.id,
        order: await order.export(),
        payment_transaction: captureResult,
        processor: captureResult.processor ? captureResult.processor.type : null,
      },
    };
    if (captureResult.error) {
      responseData.error = captureResult.error;
    }

    return responseData;
  }

  /**
   * create
   * creates an order and optionally acts on an intent if provided e.g. capture
   * Hooks
   * - validateCustomer - validates the customer exists; validates there is an intent
   * - authorizeNew - authorizes the request
   * - shouldSkipNotify - moves the query params "skipNotify" to params.skipNotify
   * - encryptSensitive - encrypts the data.card object if it is present; mutates the data.paymentToken & params.paymentToken; removes the data.card object; creates the payment_source if it dose not exist
   * - initOrderTransaction - initializes the order transaction; mutates the data.orderTransaction; mutates params.order_transaction; mutates params.transaction_id
   * - saveCustomer - saves the customer if data provided; mutates the data.customer_id; removes data.customer
   * - prepareNote - if a note is provided, it moves the note to the params object; removes the data.note; mutates params.note
   * - saveSession - if a session is provided, conditionally mutates data.session & data.session_id & data.session.user_id
   * - saveContact - mutates the params.shippingContact & params.billingContact after upserting them these are objection models
   * - ensureOrderHasCustomerAndContacts - validates that the order has required properties for a customer and contacts when attempting to capture
   *
   * @param {object} data - the expected post data
   * @param {{import('@feathersjs/feathers').Params}} params
   * @returns {object}
   */
  async create(data, params) {
    let { discount, users } = params;
    let { intent } = data;

    const ordersBaseService = this.app.service('private/orders_base');

    // FIXME: DRY this up. There are several places in which I must add properties to a whitelist in order to save it. SMH
    let orderData = _.pick(
      data,
      'billing_contact_id',
      'shipping_contact_id',
      'session_id',
      'currency_iso',
      'sales_tax',
      'id',
      'customer_id',
      'tax_is_included',
      'is_test',
      'store_id'
    );
    orderData.discount = discount;
    orderData.payment_source_id = data.paymentToken;
    orderData.account_id = data.accountId;

    // REVIEW@currency: We are hardcoding a base currency of USD for now. In a
    // future pass we will need to fetch the base currency from the account.
    const { fxRateId, conversionRate, destCurrencySymbol } = await this.app
      .service('fx')
      .get(1.0, { srcCurrencySymbol: orderData.currency_iso, destCurrencySymbol: 'USD' });

    // REVIEW@currency: There are a few reasons why we are attaching the
    // currency conversion rate to the order as opposed to just having it
    // on the payment_transaction. The first is that we may want to use the
    // conversion rate to calculate the total amount of the order in the base
    // currency, before we have captured the payment. The second is that we
    // need access to the conversion rate for reporting purposes, and we have
    // opted to lock reporting to the rate at the time of order creation.

    // NOTE@currency: We are also storing a reference to the fx_rate_id on the
    // order so that we can easily join the rates table in the case that we want
    // to do some more complex reporting using the rates table.
    orderData.fx_rate_id = fxRateId;
    orderData.base_currency_iso = destCurrencySymbol;
    orderData.base_currency_rate = conversionRate;
    // TODO@data-migration: Ensure that these columns are populated on orders
    // and order_versions.

    let order = new OrderDecorator(orderData);
    let baseOrderData = await order.export();
    baseOrderData.agent_id = users.id;

    let baseOrder = await ordersBaseService.create(
      baseOrderData,
      pickCommonParams(params, 'transaction')
    );
    // NOTE@order-decorator: Since the order was just created and the decorator
    // doesn't have an id, the fetched data is passed into the refresh method here.
    await order.refresh(baseOrder);

    // REVIEW@order-item: this should be refactored to use Objection model static methods
    if (!_.isEmpty(data.order_items)) {
      let orderItems = data.order_items.map((item) => {
        return { ...item, order_id: order.id, order_transaction_id: data.orderTransaction.id };
      });
      orderItems = await OrderItem.buildFromCartItems(orderItems);

      // NOTE@catalogs: CAT-9: It looks like the service is doing some validation, so we need to continue using it, until we move the validation layer for order_items up to this endpoint.
      // REVIEW: the validation seems to just be Joi and authorization (which should be done here & in the model). Probably safe to change to OrderItem.insert
      await this.app.service('/order_items').create(orderItems, pickCommonParams(params, 'transaction'));
    }

    // NOTE@order-decorator: If we pass true to export, we will force a refresh of the order data and its relationships.
    // NOTE@order-decorator: We export the calculated order data and use that to determine the amount we will attempt to capture.
    let calculatedOrder = await order.export(true);
    let captureResult = {};
    const captureParams = pickCommonParams(params);
    const captureData = {
      amount: calculatedOrder.total_amount,
      currency: order.currency_iso,
      idempotent_key: data.idempotent_key,
      is_test: data.is_test,
      order_transaction_id: data.orderTransaction.id,
      order: _.pick(order, ['id', 'slug']),
      payment_group_id: data.payment_group_id,
      paymentToken: data.paymentToken,
      store_id: data.store_id,
    };

    if (data.billing_contact_id) {
      captureData.billing_contact = await Contact.query().findById(data.billing_contact_id);
    }
    if (data.shipping_contact_id) {
      captureData.shipping_contact = await Contact.query().findById(data.shipping_contact_id);
    }
    if (data.customer_id) {
      captureData.customer = await Customer.query().findById(data.customer_id);
    }

    captureData.ip_address = getRequestIpAddress(data, params);

    // Make the underlying processor call when an intent is available
    switch (intent) {
      case 'capture': {
        // Run capture through the capture flow
        captureResult = await this.app.service('/payments/capture').create(captureData, captureParams);
        params.payment_transaction_id = captureResult.id;
        params.shouldClose = true;
        params.eventType = 'capture';
        break;
      }

      // REVIEW: maybe this should be the default?
      case 'build':
        break;

      case 'authorize':
        captureResult = await this.app.service('/payments/authorize').create(captureData, captureParams);

        break;

      default:
        throw new Error('Not expecting an unknown intent');
    }

    // NOTE@order-decorator: If we pass true to export, we will force a refresh of the order data and its relationships.
    const orderResult = {
      data: {
        orderTransactionId: data.orderTransaction.id,
        order: await order.export(true),
        // REVIEW@order-hooks: The raw payment transaction payload is attached
        // directly to the result here. The purpose of this is so that it can
        // be saved to the order_transaction.res in a later hook. After that,
        // in another hook, the payment_transaction from the DB is loaded and
        // attached to the result, replacing this raw payload.
        // TODO@order-hooks: Segment the data that is attached merely for
        // storage in the order_transaction.res field into a separate object
        // so that it is not attached to the result sent to the end user.
        payment_transaction: captureResult,
        processor: captureResult.processor ? captureResult.processor.type : null,
      },
    };

    if (captureResult.error) {
      orderResult.error = captureResult.error;
    }

    return orderResult;
  }
}

module.exports = Orders;
