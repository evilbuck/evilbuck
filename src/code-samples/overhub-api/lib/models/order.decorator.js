const _ = require('lodash');
const knex = require('../../services/knex');
const { parseCurrency } = require('../helpers');
const OrderObj = require('../objection_models/order.objection');
const OrderItem = require('../objection_models/order_item.objection');

const PAYMENT_METHODS = {
  nmi: 'credit_card',
  overhub: 'credit_card',
  paypal: 'paypal',
  stripe: 'credit_card',
};

function discountStrategyFactory(discount) {
  if (!discount) {
    return noDiscountStrategy;
  }

  switch (discount.type) {
    case 'percentage':
      return percentageDiscountStrategy;

    case 'fixed':
      return fixedDiscountStrategy;

    default:
      return noDiscountStrategy;
  }
}

async function percentageDiscountStrategy(order) {
  return (order.discount.value / 100) * (await order.getSubtotal());
}

async function fixedDiscountStrategy(order) {
  return order.discount.value;
}

async function noDiscountStrategy() {
  return 0;
}

// REVIEW: Ideally this whole file goes away and we move to an Objection model
class OrderDecorator {
  constructor(data) {
    // TODO: have a whitelist with approved properties to be plucked and assigned
    Object.assign(this, data);

    // TODO: implement a multiple discount architecture for future
    // assign a discount strategy
    this.discounter = discountStrategyFactory(data.discount);
  }

  /**
   * Returns all the order items attached to the order.
   *
   * @returns {Promise<Object[]>} orderItems
   */
  async getOrderItems() {
    if (!this.order_items && this.id) {
      // TODO@catalogs: CAT-35b: When there is no longer a reliance on the variant and product graphs, remove them from here.
      this.order_items = await OrderItem.query()
        .where({ order_id: this.id })
        .withGraphFetched('[variant, product, catalog_item]')
        .orderBy('created_at', 'ASC');
    }

    return this.order_items || [];
  }

  /**
   * Returns all the order items attached to the order that have not been
   * flagged as removed.
   *
   * @returns {Promise<Object[]>} orderItems
   */
  async getActiveOrderItems() {
    return _.filter(await this.getOrderItems(), (row) => {
      const is_archived = row.meta && row.meta.is_archived;
      return !row.is_removed && !is_archived;
    });
  }

  /**
   * Returns all the order items attached to the order that have been removed
   * and that have already been refunded.
   *
   * @returns {Promise<Object[]>} orderItems
   */
  async getRefundedOrderItems() {
    return _.filter(await this.getOrderItems(), { is_removed: true, is_refunded: true });
  }

  /**
   * Returns the subtotal by summing the line item amounts for each order item.
   *
   * @param {Object[]} orderItems
   * @returns {Promise<number>} the simple subtotal
   */
  async getSubtotal(orderItems) {
    orderItems = _.isArray(orderItems) ? orderItems : await this.getActiveOrderItems();
    if (!orderItems) return 0;

    return parseCurrency(
      orderItems.reduce((total, item) => {
        return (total += +item.price * +item.quantity);
      }, 0)
    );
  }

  /** NOTE@taxes: Calculating taxes is a fairly complex task and there are laws
   * governing how taxes should be calculated for each state, but here we will
   * implement a more naive approach using the following general rules.
   *
   * - If the contents of the shipment are taxable, the charges to ship it
   * are taxable.
   * - If the contents of the shipment are exempt, the charges to ship it are
   * typically exempt.
   * - If the shipment contains both exempt and taxable products, the portion
   * of the shipping charge allocated to the taxable sale is taxable, and the
   * portion attributed to the exempt sale is exempt */

  /**
   * getTaxableSubtotal
   * Calculates a subtotal based on order_items taking accounting for whether or
   * not items are taxable, and if they include a shipping charge.
   * @param {Object[]} orderItems
   * @returns {Promise<number>} the taxable subtotal
   */
  async getTaxableSubtotal(orderItems) {
    orderItems = _.isArray(orderItems) ? orderItems : await this.getActiveOrderItems();
    return parseCurrency(
      orderItems.reduce((total, item) => {
        let shipping_price = item.is_shippable ? +item.shipping_price : 0;
        return (total += item.is_taxable ? (+item.price + +shipping_price) * +item.quantity : 0);
      }, 0)
    );
  }

  async getDiscount() {
    return parseCurrency(await this.discounter(this));
  }

  /**
   * Calculate the order total based on the subtotal of order items, applied discounts,
   * shipping cost, and sales_tax.
   *
   * @returns {Promise<number>} the order total
   */
  async getTotal() {
    const salesTaxAmount = this.isTaxIncluded() ? 0 : await this.getSalesTaxAmount();
    const subTotal = await this.getSubtotal();
    const discount = await this.getDiscount();
    const shippingAmount = await this.getShippingAmount();
    return parseCurrency(subTotal - discount + shippingAmount + salesTaxAmount);
  }

  async getScopedTotal(orderItems) {
    const salesTaxAmount = this.isTaxIncluded() ? 0 : await this.getSalesTaxAmount(orderItems);
    const subTotal = await this.getSubtotal(orderItems);
    const discount = await this.getDiscount();
    const shippingAmount = await this.getShippingAmount(orderItems);
    return parseCurrency(subTotal - discount + shippingAmount + salesTaxAmount);
  }

  /**
   * Calculate the adjusted total value, which takes into account any refunds that have
   * been issued against the order total. This is essential for calculating the correct
   * funding state of the order and for determining the amount that should be refunded
   * when items are removed from an existing order. The adjusted total is clamped so it
   * can never be less than 0.00
   *
   * @returns {Promise<number>} the adjusted order total
   */
  async getAdjustedTotal() {
    const amountBlanketRefunds = await this.getBlanketRefundAmount();
    const total = await this.getTotal();
    let projectedTotal = total - amountBlanketRefunds;
    return parseCurrency(projectedTotal < 0 ? 0 : projectedTotal);
  }

  // TODO@shipping: Build an actual strategy for getting the shipping cost by using the weight and
  // volumetric dimensions to fetch an estimated shipping cost from the shipping provider.
  // Shipstation has an API for doing this.

  /**
   * Determines the shipping cost on the order using a naive strategy of summing
   * a pre-configured shipping cost on each order item.
   *
   * @param {Object[]} orderItems
   * @returns {Promise<number>} the shipping amount
   */
  async getShippingAmount(orderItems) {
    orderItems = _.isArray(orderItems) ? orderItems : await this.getActiveOrderItems();
    return parseCurrency(
      orderItems.reduce(
        (total, item) => total + (item.is_shippable ? +item.shipping_price * +item.quantity : 0),
        0
      )
    );
  }

  // FIXME: Normalize the key with which the tax rate is set.
  /**
   * Correctly formats and returns the sales tax rate that was provided to us.
   *
   * @returns {number} the sales tax rate
   */
  getSalesTaxRate() {
    return +(+this.sales_tax_rate || +this.sales_tax || 0).toFixed(4);
  }

  /**
   * Calculates the sales tax amount using one of two strategies:
   * - if tax_is_included = true then the tax amount is calculated using the
   * formula: adjusted_subtotal - (adjusted_subtotal / 1 + sales_tax_rate )
   *
   * - if tax_is_included = false then the tax amount is calculated using the
   * formula: adjusted_subtotal * sales_tax_rate
   *
   * @returns {Promise<number>} the sales tax amount
   */
  async getSalesTaxAmount(orderItems) {
    const taxableSubtotal = await this.getTaxableSubtotal(orderItems);
    const discount = await this.getDiscount();
    const adjustedSubtotal = taxableSubtotal - discount;
    const taxAmount = this.isTaxIncluded()
      ? adjustedSubtotal - adjustedSubtotal / (1 + this.getSalesTaxRate())
      : adjustedSubtotal * this.getSalesTaxRate();

    return parseCurrency(taxAmount);
  }

  /**
   * Determines whether an order is funded based on the credit balance remaining
   * on the order and the adjusted total, which factors in refunds that have
   * already been issued.
   *
   * @returns {Promise<boolean>} the funding state
   */
  async isFunded() {
    const adjustedTotal = await this.getAdjustedTotal();
    const creditBalance = await this.getCreditBalance();

    return adjustedTotal - creditBalance <= 0;
  }

  /**
   * Fetch, memoize, and return all the payment transaction records for this
   * order.
   *
   * @returns {Promise<Object[]>} payment_transactions
   */
  async getPaymentTransactions() {
    if (!this.payment_transactions && this.id) {
      this.payment_transactions = await knex('payment_transactions')
        .where({ order_id: this.id })
        .orderBy('created_at', 'ASC');
    }

    return this.payment_transactions || [];
  }

  /**
   * Fetch and return all approved payment transaction records for this order
   *
   * @returns {Promise<Object[]>} payment_transactions
   */
  async getApprovedTransactions() {
    const transactions = await this.getPaymentTransactions();
    return _.filter(transactions, { status: 'approved' });
  }

  /**
   * Calculates the remaining order credit for this order, accounting for any
   * refunds, voids, or chargebacks that have been issued against it. This is
   * required for us to know how much credit there is remaining for additional
   * refunds, and to determine the funding state of the order.
   *
   * @returns {Promise<number>} the credit balance
   */
  async getCreditBalance() {
    const transactions = await this.getApprovedTransactions();
    return this.constructor.calcCreditBalance(transactions);
  }

  /**
   * Calculates a credit balance for a given set of transactions.
   *
   * @param {Object[]} transactions
   * @returns {number} the credit balance
   */
  static calcCreditBalance(transactions) {
    return parseCurrency(
      transactions.reduce((balance, trx) => {
        balance += trx.type === 'process' ? +trx.amount : -trx.amount;
        return balance;
      }, 0)
    );
  }

  /**
   * Calculates the total amount of refunds that have already been issued against
   * the order. This is used to determine the adjusted total value of the order.
   *
   * @returns {Promise<number>} the total amount refunded
   */
  async getAmountRefunded() {
    const transactions = await this.getApprovedTransactions();
    const result = _.sumBy(
      transactions.filter((t) => t.type === 'refund'),
      (t) => +t.amount
    );
    return parseCurrency(result);
  }

  /**
   * Calculates the total amount that has been processed for this order.
   *
   * @returns {Promise<number>} the total amount refunded
   */
  async getAmountProcessed() {
    const transactions = await this.getApprovedTransactions();
    const result = _.sumBy(
      transactions.filter((t) => t.type === 'process'),
      (t) => +t.amount
    );
    return parseCurrency(result);
  }

  /**
   * Calculates the total amount of blanket refunds applied to the order.
   * Blanket refunds are refunds that are applied against the order total
   * but are not tied to any specific order_items.
   *
   * @returns {Promise<number>} the total amount of blanket refunds
   */
  async getBlanketRefundAmount() {
    const transactions = await this.getApprovedTransactions();
    const refundedOrderItems = await this.getRefundedOrderItems();
    const refundIds = _.uniq(refundedOrderItems.map((i) => i.refund_transaction_id));
    const result = _.sumBy(
      transactions.filter((t) => t.type === 'refund' && !refundIds.includes(t.id)),
      (t) => +t.amount
    );
    return parseCurrency(result);
  }

  /**
   * Calculates the outstanding balance on the order. If this number is positive
   * it indicates a an additional amount must be charged to bring the order into
   * a funded state. If this number is negative, it indicates that the order is
   * currently overfunded and that the absolute value of the balance amount can
   * be refunded to the customer.
   *
   * @returns {Promise<number>} the outstanding balance
   */
  async getOutstandingBalance() {
    const adjustedTotal = await this.getAdjustedTotal();
    const creditBalance = await this.getCreditBalance();
    return parseCurrency(adjustedTotal - creditBalance);
  }

  /**
   * Calculates the refundable balance based on the outstanding balance. If there
   * is a negative outstanding balance, then this will return the absolut value
   * of that.
   *
   * @returns {Promise<number>} the refundable balance
   */
  async getRefundableBalance() {
    const outstandingBalance = await this.getOutstandingBalance();
    return outstandingBalance < 0 ? parseCurrency(Math.abs(outstandingBalance)) : 0;
  }

  /**
   * Gets the processor_type of the first payment transaction for this order.
   * @returns {Promise<string|null>} The designator for the processor type
   */
  async getPaymentProcessorType() {
    const transactions = await this.getPaymentTransactions();
    return _.get(transactions, '[0].processor_type', null);
  }

  /**
   * Determines a payment method based on the processor_type of the first payment.
   * @returns {Promise<string|null>} The designator for the payment method
   */
  async getPaymentMethod() {
    const processor_type = await this.getPaymentProcessorType();
    return PAYMENT_METHODS[processor_type] || null;
  }

  /**
   * Returns the country_iso of the either the billing or shipping address.
   * @returns {Promise<string|null>} The country code for the order
   */
  async getCountryISO() {
    if (!this.id) return null;
    const order = await OrderObj.query().findById(this.id);
    const contact =
      (await order.$relatedQuery('shipping_contact')) ?? (await order.$relatedQuery('billing_contact'));
    return contact?.country_iso || null;
  }

  // FIXME: DRY this up. There are several places in which I must add properties to a whitelist in order to save it. SMH
  /**
   * Export order data with dynamically calculated columns for entry into the
   * database.
   * @param {boolean} shouldRefresh If the order data should be refreshed before exporting
   * @returns {Promise<Object>}
   */
  async export(shouldRefresh = false) {
    let base = _.pick(
      this,
      'id',
      'account_id',
      'base_currency_iso',
      'base_currency_rate',
      'billing_contact_id',
      'billingContact',
      'created_at',
      'currency_iso',
      'customer_id',
      'fx_rate_id',
      'is_test',
      'orderItems',
      'payment_source_id',
      'session_id',
      'shipping_contact_id',
      'shippingContact',
      'slug',
      'status',
      'store_id',
      'tax_is_included',
      'updated_at',
      'user_id'
    );

    if (shouldRefresh) {
      await this.refresh();
    }

    base = Object.assign({}, base, {
      adjusted_total_amount: await this.getAdjustedTotal(),
      country_iso: await this.getCountryISO(),
      credit_balance_amount: await this.getCreditBalance(),
      discount_amount: await this.getDiscount(),
      outstanding_balance_amount: await this.getOutstandingBalance(),
      payment_method: await this.getPaymentMethod(),
      processor_type: await this.getPaymentProcessorType(),
      refunded_amount: await this.getAmountRefunded(),
      sales_tax_amount: await this.getSalesTaxAmount(),
      sales_tax_rate: this.getSalesTaxRate(),
      shipping_amount: await this.getShippingAmount(),
      subtotal_amount: await this.getSubtotal(),
      total_amount: await this.getTotal(),
    });

    return _.omitBy(base, _.isUndefined);
  }

  /**
   * refresh
   * Update the instance with new data either from a provided object or if the
   * instance has an order id, then directly from the database.
   * @param {object} orderData
   */
  async refresh(orderData) {
    if (orderData) {
      Object.assign(this, orderData);
    } else {
      if (this.id) {
        // TODO@catalogs: CAT-36b: When there is no longer a reliance on the variant and product graphs, remove them from here.
        const order = await OrderObj.query()
          .findById(this.id)
          .withGraphFetched(
            '[payment_transactions, order_items.[fulfillment, product, variant, catalog_item]]'
          );
        Object.assign(this, order.$toJson());
      }
    }
  }

  // NOTE: expects a left join on fulfillments for `shipped_at`
  async isPartiallyFulfilled() {
    return _.some(await this.getActiveOrderItems(), (oi) => !!oi.shipped_at);
  }

  // NOTE: expects a left join on fulfillments for `shipped_at`
  async isCompletelyFulfilled() {
    const orderItems = await this.getActiveOrderItems();
    return !_.isEmpty(orderItems) && _.every(orderItems, (oi) => !!oi.shipped_at);
  }

  isCancelled() {
    return this.status === 'cancelled';
  }

  /**
   * Designates if an order has the taxable amount included in the subtotal value or if the
   * sales_tax_amount should be added to the subtotal when calculating the order total.
   *
   * @returns {boolean}
   */
  isTaxIncluded() {
    return !!this.tax_is_included;
  }
}

module.exports = OrderDecorator;
