const _ = require('lodash');
// REVIEW: the orders service is not feathers-knex. I don't think we actually use the hooks.transaction
const { hooks } = require('feathers-knex');
const { transaction } = hooks;

const { Conflict, BadRequest, Forbidden, GeneralError } = require('@feathersjs/errors');
const { subject } = require('@casl/ability');
const validate = require('@feathers-plus/validate-joi');
const { iff, isProvider } = require('feathers-hooks-common');

const { handleBelongsToAccount, handleBelongsToStore } = require('../../lib/authorization');
const encryptSensitive = require('../hooks/encrypt_sensitive');
const { authenticateJwt, createRestfulAbilityHook } = require('../hooks');
const getAuthenticatedAccount = require('../hooks/get_authenticated_account');
const { attachParentTransactionMaybe } = require('../payments/common.hooks');
const { initOrderTransaction, orderSchema, patchSchema } = require('./orders.common');
const createHook = require('../../lib/logging/create_hook');
const { saveSession } = require('./orders.common');
const { detectJsonApiHook } = require('../hooks/json_api.hooks');
const { pickCommonParams } = require('../service_common.helpers');
const { mask, maskCreditCardNumber } = require('../../lib/helpers');
const {
  Contact,
  Customer,
  PaymentGroup,
  PaymentTransaction,
  Order,
  OrderItem,
  User,
  Session,
  Store,
} = require('../../lib/objection_models');

/**
 * @typedef {import("@feathersjs/feathers").HookContext} HookContext
 */

/**
 * @typedef {import("@feathersjs/feathers").Application} Application
 */

/**
 * @typedef {import("@feathersjs/feathers").Params} Params
 */

const fetchDiscount = createHook(async function fetchDiscount(context) {
  let { data, app } = context;
  if (!data.discount_code) {
    return;
  }
  let { discount_code } = data;

  let [discount] = await app.service('/discount_codes').find({
    query: {
      code: discount_code,
    },
  });

  context.params.discount = discount;
  delete data.discount_code;
});

/**
 * saveCustomer
 * saves the customer info if provided
 *
 * @param {HookContext} context
 * @param {Application} context.app
 * @param {Params} context.params
 */
async function saveCustomer(context) {
  let { data, app, params } = context;
  let { users: authenticatedUser } = params;
  let session = {};
  if (data?.session?.id) {
    session = await Session.query().findById(data.session.id);
  }

  // we always want to patch a user
  // look for existing customer in the session
  if (_.isEmpty(data.customer) && !session.user_id) {
    return;
  }

  // TODO@validation: move this to a separate validation function
  // if the customer object has a user_id and the session object has a user_id and they're not the same
  if (session?.user_id && data?.customer?.id && session.user_id != data.customer.id) {
    throw GeneralError(`Different id's were provided for session.user_id and order.user_id`);
  }

  let { customer } = data;

  // strip the timestamps so they're properly updated (this may not be needed, need to check knex.js)
  customer = _.omit(customer, 'created_at', 'updated_at');
  if (!customer.id && session.user_id) {
    customer.id = session.user_id;
  }

  // REVIEW@validation: are we guarding against stealing customers?
  customer.account_id = authenticatedUser.account_id;

  const usersService = app.service('/users');
  let authParams = pickCommonParams(params);
  // FIXME: this is really ugly. This usersService call should be replaced with User Objection queries
  // which requires refactoring some of the hooks
  if (customer.id) {
    params.customer = await usersService.patch(customer.id, customer, authParams);
  } else {
    try {
      params.customer = await usersService.create(customer, authParams);
    } catch (error) {
      // FIXME: this is really ugly. This usersService call should be replaced with User Objection queries
      if (error instanceof Conflict) {
        let refreshedCustomer = await User.query()
          .findOne({ account_id: customer.account_id, email: customer.email })
          .whereIn('type', ['prospect', 'customer']);
        params.customer = await usersService.patch(refreshedCustomer.id, customer, authParams);
      } else {
        throw error;
      }
    }
  }
  data.customer_id = params.customer.id;

  context.data = _.omit(data, 'customer');
}

async function hydrateCustomer(context) {
  let { result } = context;
  let {
    data: { order },
  } = result;
  if (!order.customer_id) {
    return;
  }
  let { customer_id } = order;

  // let customer = await app.service('/users').get(customer_id, params);
  let customer = await User.query().findById(customer_id);
  // NOTE: I shouldn't need to omit here, but for some reason
  // protect('password') isn't working on the users.hooks
  // it does inside the hook `protect` return, but something else must be mutating the context.result or context.dispatch
  context.result.data.customer = _.omit(customer, 'password', 'account_id');
}

/**
 * saveContact
 * saves the contact info if provided and updates the billing if billing_same_as_shipping bool is true
 * Mutates the context.params.shippingContact if shipping contact is provided
 * Mutates the context.params.billingContact if billing contact is provided
 *
 * @param {HookContext} context
 * @param {Application} context.app
 * @param {Params} context.params
 * @param {string} context.params.customer.id
 * @param {object} context.data.shipping_contact
 * @param {object} context.data.billing_contact
 */
async function saveContact(context) {
  let { data, params, app } = context;

  let shippingContact;
  let userId = params?.customer?.id;
  const contactsService = app.service('/contacts');

  if (!_.isEmpty(data.shipping_contact)) {
    let shippingContactData = { ...data.shipping_contact };
    if (!shippingContactData.type) {
      shippingContactData.type = 'shipping';
    }

    if (userId) {
      shippingContactData.user_id = userId;
    }

    shippingContact = await contactsService.patch(shippingContactData.id ?? null, shippingContactData);

    params.shippingContact = shippingContact;
    // REVIEW: this might be an early way of passing variables through to another
    // hook or the service call. Adding things to the data object should not be done if only
    // to use ancillary to the services' main function.
    // the preferred way is params.shippingContact = shippingContact
    data.shippingContact = shippingContact;
    data.shipping_contact_id = shippingContact.id;

    params.shippingUpdated = true;
  }

  // this logic assumes the boolean billing_same_as_shipping takes precedence
  if (data.billing_same_as_shipping && !_.isEmpty(data.shipping_contact_id)) {
    data.billing_contact_id = data.shipping_contact_id;
    params.billingUpdated = true;
    // assign billing contact id
  } else if (!_.isEmpty(data.billing_contact)) {
    let billingContactData = { ...data.billing_contact, user_id: userId };
    if (!billingContactData.type) {
      billingContactData.type = 'billing';
    }
    let billingContact;
    billingContact = await contactsService.patch(billingContactData.id ?? null, billingContactData);

    data.billingContact = billingContact;
    data.billing_contact_id = billingContact.id;
    params.billingUpdated = true;
  }

  return context;
}

/**
 * closeOrderTransaction
 * patches the order_transaction with the order_id and the result of the order method from the service
 *
 * @param {HookContext} context
 */
async function closeOrderTransaction(context) {
  let { result, data, params } = context;
  let { payment_transaction_id } = params;
  let orderTransactionData = {
    order_id: result.data.order.id,
    res: result,
  };

  if (payment_transaction_id) {
    orderTransactionData.payment_transaction_id = payment_transaction_id;
  }
  // REVIEW@order-hooks: Why do we attach order_id to params? Where does it get consumed?
  params.order_id = result.data.order.id;
  await context.app
    .service(`/order_transactions`)
    .patch(data.orderTransaction.id, orderTransactionData, pickCommonParams(params));
}

async function hydrateContacts(context) {
  const contactsService = context.app.service('/contacts');
  const commonServiceParams = _.pick(context.params, 'api_application');
  let order = context.result.data.order;
  if (order.shipping_contact_id) {
    order.shippingContact = await contactsService.get(order.shipping_contact_id, commonServiceParams);
  }

  if (order.billing_contact_id) {
    order.billingContact = await contactsService.get(order.billing_contact_id, commonServiceParams);
  }
}

// NOTE: deprecated. Need to find out how this is consumed and refactor
// use json-api request w/ hook
// NOTE@order-items: This might need to be removed or refactored depending on
// how this data is being used.
async function hydrateOrderItems(context) {
  let { result } = context;
  if (!result) return;

  const orderItems = await OrderItem.query()
    .where('order_id', result.data.order.id)
    .withGraphFetched('[variant, product, catalog_item]');

  context.result.data.order.orderItems = orderItems;
}

// REVIEW@order-hooks: What is the purpose of this hook? If we need
// order_number to be a proxy for the slug, we should do that as a virtual
// column on the model.
function slugToOrderNo(context) {
  let orderNo = context.result.data.order.slug;
  context.result.data.order.order_number = orderNo;
}

async function updateSalesTax(context) {
  let { data, params, app } = context;
  let { api_application } = params;

  const { shippingContact, billingContact, order } = params;
  const contact = billingContact || shippingContact;

  // If the order already exists, reuse the sales_tax_rate
  if (order && order.sales_tax_rate) {
    data.sales_tax = +order.sales_tax_rate;
    // This is a naive implementation of international sales tax calculation
    // TODO: We need to add a comprehensive tax strategy here in the future.
  } else if (contact && contact.country_iso == 'US' && contact.postal_code) {
    let rates = await app
      .service('/sales_taxes')
      .find({ query: { postalcode: shippingContact.postal_code }, api_application });
    let { results } = rates.data;

    // REVIEW@taxrate: might want a different methodology for selecting from multiple taxrates
    // right now, we take the highest tax rate
    let taxRate = Math.max(...results.map((d) => d.taxSales));
    // Verify the final tax rate given is not Infinity, otherwise we fallback to 0
    if (Number.isFinite(taxRate)) {
      data.sales_tax = taxRate;
    } else {
      data.sales_tax = 0;
    }
  } else {
    data.sales_tax = null;
  }
}

// TODO@order-hooks: This whole thing needs to be refactored as an instance method on the Order model.
/**
 * updateOrderStatus
 * calculates the cached, calculated columns and saves the order record
 * calculates the order status based on the payment transactions as a whole
 *
 * @param {HookContext} context - feathers hooks params
 */
async function updateOrderStatus(context) {
  let { result, app, params } = context;

  let orderId = result.data.order.id;
  let paymentTransactions = await Order.relatedQuery('payment_transactions').for(orderId);

  // Determine the status of an order using the following rules:
  // - partials have no transactions.
  // - Sales are orders with one or more successful transactions.
  // - Declines are orders with only declined or rejected transactions.
  // - Upsells are the sum of all secondary transactions across all orders.
  // - Each group should be distinct.
  let orderStatus = 'unknown';
  // REVIEW: should we handle rejected transactions differently?
  if (
    !_.isEmpty(paymentTransactions) &&
    _.every(paymentTransactions, (pt) => {
      return _.includes(['rejected', 'declined'], pt.status);
    })
  ) {
    orderStatus = 'declined';
  }
  if (_.some(paymentTransactions, { status: 'approved' })) {
    orderStatus = 'sale';
  }
  // If we have no transactions, or only transactions in an error state, we're a partial.
  if (
    paymentTransactions.length == 0 ||
    _.every(paymentTransactions, (pt) => {
      return _.includes(['error', 'pending'], pt.status);
    })
  ) {
    orderStatus = 'partial';
  }

  result.data.order.status = orderStatus;
  context.dispatch = result;

  // REVIEW: We need a better solution for getting a subset of data to send to orders_base
  const patchData = _.pick(result.data.order, [
    'adjusted_total_amount',
    'country_iso',
    'credit_balance_amount',
    'discount_amount',
    'outstanding_balance_amount',
    'payment_method',
    'processor_type',
    'refunded_amount',
    'sales_tax_amount',
    'shipping_amount',
    'status',
    'subtotal_amount',
    'total_amount',
  ]);

  // TODO@objection: replace with objection and handle the few hooks with a beforeUpdate hook
  await app.service('/orders_base').patch(orderId, patchData, pickCommonParams(params));
}

async function loadCurrentOrderStatus(context) {
  let { app, params, id } = context;
  context.params.order = await app
    .service('/orders_base')
    .get(id, pickCommonParams(params, 'transaction'));
}

/**
 * prepareNote
 * saves a note if proviided
 *
 * @param {object} context.data.note - the note object
 * @param {Params} context.params - the feathers params
 */
async function prepareNote(context) {
  let { data, params } = context;
  if (data.note) {
    params.note = data.note;
    context.data = _.omit(data, 'note');
  }
}

async function maybeSaveNote(context) {
  let { app, params } = context;
  let authParams = pickCommonParams(params, 'transaction');

  if (params.note) {
    await app.service('/notes').create(params.note, authParams);
  }
}

/**
 * Builds order_items data from a set of cart items or existing order items,
 * and determines whether to create, patch, or remove order_items depending
 * on the requested action attached to each object in the list.
 *
 * @param {object} context
 */
async function buildAndMutateOrderItems(context) {
  let { app, data, id, params } = context;
  let { order_items, should_replace_items = false } = data;

  if (!order_items) {
    return;
  }

  const order = await Order.query().findById(id);
  const INVALID_ORDER_STATES = ['cancelled', 'refunded'];
  if (INVALID_ORDER_STATES.includes(order.status)) {
    throw new BadRequest(`Cannot modify order_items on an order with status: ${order.status}`);
  }

  if (should_replace_items) {
    if (!['partial', 'declined'].includes(order.status)) {
      throw new BadRequest(`Cannot replace order_items on an order with status: ${order.status}`);
    }

    // Remove all existing order_items, since we are going to replace them
    await OrderItem.query().where('order_id', id).delete();
  }

  // associate the order_tranasction and order to the order items before creating or patching
  let orderItems = data.order_items.map((item) => {
    let is_post_sale = params.is_post_sale ?? false;
    return {
      ...item,
      order_id: id,
      order_transaction_id: data.orderTransaction.id,
      is_post_sale,
    };
  });
  orderItems = await OrderItem.buildFromCartItems(orderItems);

  const newOrderItems = orderItems.filter((oi) => !oi.id);
  const existingOrderItems = orderItems.filter((oi) => !!oi.id);

  const orderItemService = app.service('/order_items');
  if (!_.isEmpty(newOrderItems)) {
    // TODO@objection: move toward objection model without service call
    // create the new order items and reference for use in the orders.patch method
    params.new_order_items = await orderItemService.create(
      newOrderItems,
      pickCommonParams(params, 'transaction')
    );
  }

  const ALLOWED_ACTIONS = ['create', 'remove', 'patch'];
  // check if the order items have been updated
  if (existingOrderItems.length) {
    await existingOrderItems.reduce((patchPromise, orderItem) => {
      return patchPromise.then(() => {
        let action = orderItem.action || 'create';
        // TODO@order-items: We should move this validation out of this promise
        // loop and instead validate the possible actions as enums via Joi.
        if (!ALLOWED_ACTIONS.includes(action)) {
          throw new Error(`Cannot perform action: ${action} on order_item.`);
        }

        // REVIEW@order-items: It might be smarter to build up a set of bulk
        // operations here and submit them in a single request in the future.
        switch (action) {
          case 'remove':
            // REVIEW: Can this partial state exist when an order item should not be hard deleted?
            // this might be the wrong check here
            // UPDATE: yes, we don't want it to work this way. There is a card in notion.
            if (order.status === 'partial') {
              return orderItemService.remove(orderItem.id, pickCommonParams(params, 'transaction'));
            } else {
              // NOTE@feathers-service: the only reason a service is used here is for the isShipped hooks
              let orderItemPatchData = {
                is_removed: true,
                fulfillment_id: null,
                ..._.pick(orderItem, 'order_transaction_id', 'meta'),
              };

              return orderItemService.patch(
                orderItem.id,
                orderItemPatchData,
                pickCommonParams(params, 'transaction')
              );
            }

          case 'patch': {
            let patchData = _.pick(
              orderItem,
              'quantity',
              'price',
              'discount',
              'order_transaction_id',
              'meta'
            );
            return orderItemService.patch(
              orderItem.id,
              patchData,
              pickCommonParams(params, 'transaction')
            );
          }
        }
      });
    }, Promise.resolve(null));
  }

  params.order_items = await orderItemService.find(
    {
      query: { order_id: id },
    },
    pickCommonParams(params)
  );
}

/**
 * maybeCloseOrder
 * Creates an order version, effectively "closing" an order
 *
 * @param {HookContext} context
 * @param {{import("@feathersjs/feathers").Params}} context.params - the Feathers params object
 * @param {object} context.app - the Feathers application object
 * @param {boolean} context.params.shouldClose - denotes whether or not the order should close. set by a prior process in this service method call and/or hooks
 * @param {object} context.result - the result of the service call
 * @param {string} context.id - the id of the order
 */
async function maybeCloseOrder(context) {
  let { app, params, result, id } = context;
  let { shouldClose } = params;

  if (!shouldClose) {
    return;
  }
  id = id || result.data.order.id;

  let providerLessParams = _.omit(params, 'provider');
  // TODO: set the event type based on the type of order call
  await app.service('/order_versions').create({ order_id: params.order_id }, providerLessParams);
  await Order.query().findById(id).patch({ status: 'closed' });
}

async function attachPaymentTransaction(context) {
  let { params, result } = context;

  let { payment_transaction_id } = params;
  if (!payment_transaction_id) {
    return;
  }

  // NOTE@order-hooks: This entire hook exists to replace the raw
  // payment_transaction payload in the result with a sanitized on
  // from the database after the raw result data has been saved as
  // part of the order_transaction.res
  // TODO@order-hooks: The order transaction can be exported from
  // decorator as part of the result, so this hook can be removed.]
  result.data.payment_transaction = await PaymentTransaction.query()
    .findById(payment_transaction_id)
    .select([
      'id',
      'amount',
      'credit_balance',
      'created_at',
      'updated_at',
      'meta',
      'order_id',
      'order_transaction_id',
      'parent_id',
      'processor_type',
      'type',
      'upsell',
      'status',
    ]);
}

/**
 * ensureOrderHasCustomerAndContacts
 * validates that the order has required properties for a customer and contacts when attempting to capture
 *
 * @param {HookContext} context
 */
async function ensureOrderHasCustomerAndContacts(context) {
  const { data, params } = context;
  const { order = {} } = params;
  const customer_id = data.customer_id || order.customer_id;
  const billing_contact_id = data.billing_contact_id || order.billing_contact_id;
  const shipping_contact_id = data.shipping_contact_id || order.shipping_contact_id;

  // REVIEW: We can probably just move these validations to the Joi schema
  // when we split out the endpoints for build and capture.
  if (data.intent !== 'capture') return;

  if (!customer_id) {
    throw new BadRequest('Cannot capture an order without a customer attached. (customer_id is empty)');
  }

  if (!billing_contact_id) {
    throw new BadRequest(
      'Cannot capture an order without a billing contact attached. (billing_contact_id is empty)'
    );
  }

  // REVIEW: EA: There may be circumstances where we don't require a shipping
  // contact to capture an order.
  if (!shipping_contact_id) {
    throw new BadRequest(
      'Cannot capture an order without a shipping contact attached. (shipping_contact_id is empty)'
    );
  }
}

async function rejectModificationsToCancelledOrders(context) {
  const { data } = context;
  // REVIEW: Loading the order from the database here because we need this
  // to happen very early. We should layout where shared data needs to be
  // loaded for the hooks.
  if (data.id) {
    const order = await Order.query().findOne({ id: data.id });

    if (order.status === 'cancelled') {
      throw new BadRequest('Cannot modify a cancelled order.');
    }
  }
}

async function updateOrderItemsWithFundingStateAndAttach({ params, result }) {
  const { payment_transaction_id } = params;
  const { order, payment_transaction } = result.data;

  // TODO@order-hooks: This code should be refactored as a helper method and
  // called inline within the service methods.
  if (payment_transaction?.status === 'approved') {
    await OrderItem.query()
      .patch({ is_funded: true, funding_transaction_id: payment_transaction_id })
      .where('order_id', order.id)
      .whereNull('funding_transaction_id');

    // NOTE@order-decorator: Because we updated the order_items with the
    // funding_transaction_id, the exported decorator data is now out of date.
    // NOTE@order-hooks: The order data attached to the context here is used to
    // populate order_transactions.res
    const orderItems = await OrderItem.query()
      .where('order_id', order.id)
      .withGraphFetched('[product, variant, catalog_item]');

    order.orderItems = orderItems.map((oi) => oi.$toJson());
  }
}

const authorizeFind = createRestfulAbilityHook(async ({ params }) => {
  let { users } = params;
  params.knex = Order.query().where({ account_id: users.account_id });
});

async function authorizePaymentGroup(ability, payment_group_id, store) {
  let paymentGroup = await PaymentGroup.query().findOne({ store_id: store.id, slug: payment_group_id });
  if (!paymentGroup) {
    throw new BadRequest(`Payment group provided, ${payment_group_id} does not exist`);
  }

  handleBelongsToAccount(
    ability,
    subject('Account', { id: paymentGroup.account_id }),
    'Payment group account is out of scope for this user'
  );
  handleBelongsToStore(
    ability,
    subject('stores', { id: paymentGroup.store_id }),
    `Payment group store is out of scope for the user`
  );
}

const authorizeExisting = createRestfulAbilityHook(async ({ params, id, data }) => {
  let { ability } = params;

  // let product = await Variant.relatedQuery('product').for(id).findOne({});
  let order = await Order.query().findById(id).withGraphFetched('customer');
  let { customer } = order;

  handleBelongsToAccount(ability, subject('Account', { id: order.account_id }), 'existing order error');

  // only for patch
  if (_.isObject(data)) {
    let { payment_group_id, store_id } = data;

    let store = await Store.query().findById(store_id);
    if (!store) {
      throw new BadRequest('Store does not exist');
    }
    // check for session account membership to same account as the user

    // NOTE: the session.id will override the session_id if available
    if (data?.session?.id) {
      let session = await Session.query().findById(data.session.id);
      let store = await session.$relatedQuery('store');
      handleBelongsToAccount(
        ability,
        subject('Account', { id: store.account_id }),
        'The session is out of scope'
      );

      // REVIEW: Need to look at how we validate the customer and it's contacts considering all the available options
      // or lockdown the exact workflow for creating a new customer and contacts within the order.
      // it might be a good idea to enforce these entities are created before the order is created.
      // right now it's too loose which allows a large number of variables for which entities exist and how they would be validated
      // check that the session belongs to this customer, if a customer is available
      if (order.customer_id && order.customer_id !== session.user_id) {
        throw new Forbidden(`This session does not belong to this customer`);
      }
    }
    // check if contacts actually belong to user
    if (data?.billing_contact?.id && customer) {
      let contact = await Contact.query().findById(data.billing_contact.id);
      if (contact.user_id !== customer.id) {
        throw new Forbidden(`The billing contact is out of scope for this customer`);
      }
    }

    // REVIEW: Need to look at how we validate the customer and it's contacts considering all the available options
    // or lockdown the exact workflow for creating a new customer and contacts within the order.
    // it might be a good idea to enforce these entities are created before the order is created.
    // right now it's too loose which allows a large number of variables for which entities exist and how they would be validated
    if (data?.shipping_contact?.id && customer) {
      let contact = await Contact.query().findById(data.shipping_contact.id);
      if (contact.user_id !== customer.id) {
        throw new Forbidden(`The shipping contact is out of scope for this customer`);
      }
    }

    // verify that customer belongs to the same account
    if (data?.customer?.id) {
      let customer = await Customer.query().findById(data.customer.id);
      handleBelongsToAccount(
        ability,
        subject('Account', { id: customer.account_id }),
        'Customer is out of scope of account'
      );

      // TODO@order-authz: must check that the contacts and payment sources belong
    }

    // authorize the payment group
    if (payment_group_id) {
      await authorizePaymentGroup(ability, payment_group_id, store);
    }
  }
});

const authorizeNew = createRestfulAbilityHook(async ({ data, params }) => {
  let { ability } = params;
  let { store_id, payment_group_id } = data;

  // REVIEW: make sure this matches up with what is actually used for the mutating entity hooks
  // determine entity id priorities
  let customerId = data.customer_id ?? data?.customer?.id;
  let shippingContactId = data.shipping_contact_id ?? data?.shipping_contact?.id;
  let billingContactId = data.billing_contact_id ?? data?.billing_contact?.id;

  let store = await Store.query().findById(store_id);
  if (!store) {
    throw new BadRequest('Store does not exist');
  }

  handleBelongsToAccount(ability, subject('Account', { id: store.account_id }));
  handleBelongsToStore(ability, subject('stores', { id: store.id }));

  if (data?.session?.id) {
    let session = await Session.query().findById(data.session.id);

    // determine if the session belongs to a customer of this account
    handleBelongsToAccount(
      ability,
      subject('Account', { id: session.account_id }),
      'The session is out of scope of the account'
    );

    handleBelongsToStore(
      ability,
      subject('stores', { id: session.store_id }),
      'The session is out of scope of the store'
    );

    // determine if the session belongs to the existing customer being passed in
    if (data?.customer?.id) {
      let customer = await Customer.query().findById(data.customer.id);
      if (session.user_id !== customer.id) {
        throw new Forbidden(`session does not belong to this customer`);
      }
    }
  }

  // determine if the billing contact belongs to the specified customer
  if (billingContactId && customerId) {
    let billingContact = await Contact.query().findById(billingContactId);
    if (billingContact.user_id !== customerId) {
      throw new Forbidden(`The billing contact is out of scope for this customer`);
    }
  }

  // determine if the shipping contact belongs to the specified customer
  // let customerId = data.customer_id ?? data?.customer?.id;
  if (shippingContactId && customerId) {
    let shippingContact = await Contact.query().findById(shippingContactId);
    if (shippingContact.user_id !== customerId) {
      throw new Forbidden(`The shipping contact is out of scope for this customer`);
    }
  }

  // determine if the shipping contact belongs to the account
  if (shippingContactId) {
    let shippingContactUser = await Contact.relatedQuery('user').for(shippingContactId).findOne({});
    handleBelongsToAccount(
      ability,
      subject('Account', { id: shippingContactUser.account_id }),
      'shipping contact is out of scope for this account'
    );
  }

  // determine if the billing contact belongs to the account
  if (billingContactId) {
    let billingContactUser = await Contact.relatedQuery('user').for(billingContactId).findOne({});
    handleBelongsToAccount(
      ability,
      subject('Account', { id: billingContactUser.account_id }),
      'billing contact is out of scope for this account'
    );
  }

  // authorize the payment group
  if (payment_group_id) {
    await authorizePaymentGroup(ability, payment_group_id, store);
  }
});

/**
 * A hook that checks for a debug parameter in the request called skipNotify
 * and if it is set to true, it attaches the skipNotify flag to the context
 * so that it can cleanly be passed between services.
 * @param {object} context The Feathers context
 * @param {object} context.params The Feathers params
 */
async function shouldSkipNotify({ params }) {
  const { query } = params;
  params.skipNotify = query.skipNotify === 'true';
  // NOTE: For some reason leaving this as part of the query results in
  // database errors being thrown by the subsequent hooks.
  params.query = _.omit(query, 'skipNotify');
}

async function validateCustomer({ data, params }) {
  let { intent, customer, customer_id } = data;

  if (!intent) {
    throw BadRequest(`An Order intent must be specified`);
  }

  if (intent === 'capture') {
    if (!customer && !customer_id && !params.customer) {
      throw BadRequest(`A Customer must be specified for capture intent`);
    }
  }
}

async function maskCreditCardErrorsHook(context) {
  let data = { ...context.data };
  if (data?.card?.number) {
    data.card.number = maskCreditCardNumber(data.card.number);
  }
  if (data?.card?.cvc) {
    data.card.cvc = mask(data.card.cvc);
  }

  context.dispatch = data;
}

module.exports = {
  before: {
    all: [authenticateJwt, iff(isProvider('rest'), getAuthenticatedAccount)],

    get: [authorizeExisting, detectJsonApiHook],

    find: [authorizeFind],

    create: [
      validate.form(orderSchema),
      validateCustomer,
      authorizeNew,
      shouldSkipNotify,
      encryptSensitive,
      initOrderTransaction,
      createHook(saveCustomer),
      createHook(prepareNote),
      createHook(saveSession),
      createHook(saveContact),
      createHook(ensureOrderHasCustomerAndContacts),
      createHook(updateSalesTax),
      fetchDiscount,
    ],

    patch: [
      validate.form(patchSchema),
      authorizeExisting,
      shouldSkipNotify,
      encryptSensitive,
      createHook(rejectModificationsToCancelledOrders),
      initOrderTransaction,
      createHook(buildAndMutateOrderItems),
      createHook(attachParentTransactionMaybe),
      transaction.start(),
      createHook(saveCustomer),
      createHook(prepareNote),
      createHook(loadCurrentOrderStatus),
      createHook(saveSession),
      createHook(saveContact),
      createHook(ensureOrderHasCustomerAndContacts),
      createHook(updateSalesTax),
      fetchDiscount,
    ],
  },

  after: {
    get: [hydrateOrderItems, slugToOrderNo],

    create: [
      createHook(maybeSaveNote),
      createHook(hydrateContacts),
      createHook(updateOrderItemsWithFundingStateAndAttach),
      createHook(hydrateCustomer),
      createHook(closeOrderTransaction),
      transaction.end(),
      createHook(slugToOrderNo),
      createHook(attachPaymentTransaction),
      updateOrderStatus,
      maybeCloseOrder,
    ],

    patch: [
      createHook(maybeSaveNote),
      createHook(hydrateContacts),
      createHook(updateOrderItemsWithFundingStateAndAttach),
      createHook(hydrateCustomer),
      createHook(closeOrderTransaction),
      transaction.end(),
      createHook(slugToOrderNo),
      createHook(attachPaymentTransaction),
      updateOrderStatus,
      createHook(maybeCloseOrder),
    ],
  },
  error: {
    create: [
      maskCreditCardErrorsHook,
      // REVIEW: what state is the order in after this?
      transaction.rollback(),
    ],
    patch: [
      maskCreditCardErrorsHook,
      // REVIEW: what state is the order in after this?
      transaction.rollback(),
    ],
  },
};
