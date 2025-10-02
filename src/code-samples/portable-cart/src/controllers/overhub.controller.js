import _ from 'lodash';
import { createGlobalState } from '@vueuse/core';
import axios from 'axios';
import qs from 'qs';

import { useRouter } from '../lib/router.js';
import debug from '../lib/debug.js';
import { interceptUnauthenticated } from '../lib/client';
import ClientPersist from '../models/client_persist.js';
import Publisher from '../lib/publisher.js';

import useOverhubStore from '../stores/overhub_store.js';

class OverhubController {
  constructor(router, options = {}) {
    this.overhub_store = useOverhubStore();
    this.router = router;

    // NOTE: this should be set as an environment specific configuration
    // TODO: we need the .env.* files for the other environments
    if (!process.env.API_URL) {
      debug.warn('API_URL is not set in the environment, using default value');
    }

    const apiUrl = options.api_url ?? 'http://localhost:3000';
    // const accessToken = this.overhub_store.getConfig('api_key');
    const accessToken = options.api_key;

    this.clientPersist = new ClientPersist();

    // TODO: this should use the client from lib/client.js
    // but it's causing an error outside of the vue app.
    // might need to refactor the client to be a traditional js singleton
    if (_.isNil(accessToken)) {
      debug.warn('init::axios::accessToken is not set');
    }

    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      paramsSerializer: {
        serialize: (params) => qs.stringify(params, { encodeValuesOnly: true }),
      },
    });

    // NOTE: this only runs in development
    interceptUnauthenticated(this.client);
  }

  // ensure that this is a singleton
  static getInstance(router, options = {}) {
    if (!this.instance) {
      this.instance = new OverhubController(router, options);
    }
    return this.instance;
  }

  async createCart() {
    let res = await this.client.post(`/carts`, {
      customer_id: this.overhub_store?.prospect?.id,
      store_id: this.overhub_store.store_id,
      session_id: this.overhub_store.session.id,
    });
    let { data } = res;
    let { data: cart, cart_token } = data;

    this.setCartToken(cart_token);
    this.clientPersist.setItem('cart_id', cart.id);

    return data;
  }

  async loadCart(cart_id) {
    cart_id = cart_id ?? this.overhub_store.cart_id;
    let { data } = await this.client.get(`/carts/${cart_id}`, {
      params: {
        cart_token: this.overhub_store.cart_token,
        $eager: `[
          cart_items.[
            catalog_item
          ], 
          cart_packages.[package]
        ]`,
      },
    });
    debug.log('controller: load cart - data:', data);
    let { data: cart } = data;
    this.overhub_store.setCart(cart);
  }

  setCartToken(cart_token) {
    this.overhub_store.setCartToken(cart_token);
    this.clientPersist.setItem('cart_token', cart_token);
  }

  // NOTE: this isn't used, and hasn't been tested since the POC
  // everything is a through a package right now
  // async addToCart(catalogItem) {
  //   if (!this.overhub_store.cart?.id) {
  //     // REVIEW: this should probably be a observable property on the store
  //     let cart = await this.createCart(this.overhub_store.store_id);

  //     this.overhub_store.cart.id = cart.id;
  //   }

  //   let { data } = await this.client.post(`/cart_items`, {
  //     cart_id: this.store.cart_id,
  //     store_id: this.store.store_id,
  //     catalog_item_id: catalogItem.id,
  //   });

  //   // refresh the cart with the associated cart items
  //   let { data: cart } = await this.client.get(`/carts/${this.store.cart_id}`, {
  //     params: { store_id: this.store.store_id, $eager: `[cart_items.[catalog_item]]` },
  //   });
  //   this.overhub_store.setCart(cart);
  //   this.overhub_store.session.id = cart.session_id;
  //   this.overhub_store.cartItems = cart.cart_items.map((item) => {
  //     return { ...item, name: item.catalog_item.name, price: item.catalog_item.price };
  //   });
  // }

  /**
   * makes an api request to remove the package from the cart
   * saves the cart to the pinia overhub store
   *
   * @async
   * @param {string} cartPackageId - the cart id uuid
   *
   * @throws {Error} - if there is an error removing the package from the cart
   * @returns {void}
   */
  async removePackageFromCart(cartPackageId) {
    try {
      let { data } = await this.client.delete(`/carts/packages/${cartPackageId}`, {
        headers: { 'x-cart-token': this.overhub_store.cart_token },
      });
      this.overhub_store.setCart(data);
      this.overhub_store.publisher.trigger(Publisher.EVENTS.PACKAGE_REMOVED, data);
      this.overhub_store.publisher.trigger(Publisher.EVENTS.CART_UPDATED, data);
    } catch (error) {
      this.overhub_store.recordError(error);
      throw new Error(`Error removing package (${cartPackageId}) from the cart: ${error}`);
    }
  }

  async addPackageToCart(pkg) {
    if (!this.overhub_store.cart?.id) {
      // REVIEW: this should probably be a observable property on the store
      let cart = await this.createCart();

      this.overhub_store.cart.id = cart.id;
    }

    // TODO: implement functionality to support optional group_key support
    // for now, we assume that the package has a group_key, but not really utilize it yet
    // If there is an existing package in the cart, remove it
    // this assumes one package at a time for now
    // We'll need to change this if we want to support multiple packages
    let selectedPackageId = this.overhub_store.getConfig('selectedPackageId');

    // if there is a selected package, we need to remove it from the cart before adding the new one
    // we need to find the cart_package_id (the cart_package instance) that was created when the package was added to the cart
    if (selectedPackageId) {
      let cartPackage = this.overhub_store.cart.cart_packages.find(
        (cp) => cp.package_id === selectedPackageId
      );
      if (!cartPackage) {
        throw new Error(
          `Could not find cart package for package id: ${selectedPackageId}, for selected package id: ${selectedPackageId}`
        );
      }
      await this.removePackageFromCart(cartPackage.id);
    }

    try {
      let { data: package_add_response_data } = await this.client.post(`/carts/packages`, {
        cart_id: this.overhub_store.cart.id,
        cart_token: this.overhub_store.cart_token,
        customer_id: this.overhub_store.prospect?.id,
        package_id: pkg.id,
        session_id: this.overhub_store?.session?.id,
      });
      let cart_data = package_add_response_data.data;
      this.overhub_store.setCart(cart_data);
      this.overhub_store.setSelectedPackageId(pkg.id);

      // set the projection that is returned from the server
      this.overhub_store.order_projection = package_add_response_data.extra.order_projection.data;

      // publish the events
      this.overhub_store.publisher.trigger(Publisher.EVENTS.PACKAGE_SELECTED, pkg);
      this.overhub_store.publisher.trigger(Publisher.EVENTS.CART_UPDATED, cart_data);
    } catch (error) {
      console.error(error);
      this.overhub_store.recordError(error);
    }
  }

  // REVIEW: at the moment this is just the next step from the checkout page
  // it's hard coded, but could be turned into something dynamic based on a config
  async goToNextStep() {
    let nextPageUrl = this.getConfig('success_url');
    location.href = nextPageUrl;
  }

  setPackageType(packageType) {
    this.overhub_store.setFilter('package_type', packageType);
  }

  async loadCatalog(store_id, catalog_id) {
    let catalogData;
    // NOTE: just using this feature flag for easy testing during dev
    ({ data: catalogData } = await this.client.get(`/carts/catalogs/${catalog_id}`, {
      params: {
        store_id,
        $eager: `[
            catalog_items, 
            packages.[
              package_items
            ]
          ]`,
      },
    }));

    // pinia
    this.overhub_store.availablePackages = catalogData.packages;
  }

  /**
   * loads the order from the server into the pinia store
   *
   * @param {string} order_id
   * @param {object} [query] - query params to pass to the server
   *
   * @returns {Promise<void>}
   */
  async loadOrder(order_id, query = {}) {
    let { data } = await this.client.get(`/carts/orders/${order_id}`, {
      params: {
        public_token: this.overhub_store.public_token,
        store_id: this.overhub_store.store_id,
        ...query,
      },
    });
    let { data: order } = data;

    this.overhub_store.setOrder(order);
    this.overhub_store.setConfig('currency_iso', order.currency_iso);
    this.overhub_store.session = { id: order.session_id };
    this.overhub_store.billing_contact = { id: order.billing_contact_id };
    this.overhub_store.shipping_contact = { id: order.shipping_contact_id };
    this.overhub_store.customer = order.customer;
    this.overhub_store.prospect = { ...this.overhub_store.prospect, id: order.customer_id };
  }

  getConfig(property) {
    return this.overhub_store.getConfig(property);
  }

  setConfig(property, value) {
    this.overhub_store.setConfig(property, value);
  }

  setColor(color) {
    this.setConfig('color', color);
  }

  setSize(size) {
    this.setConfig('size', size);
  }
  /**
   * Creates a payment token for the given data.
   *
   * @async
   *
   * @param {Object} data - The data object containing the necessary information.
   * @param {string} data.cart_id - The ID of the cart.
   * @param {Object} data.card - The card details.
   * @param {string} data.card.number - The card number.
   * @param {string} data.card.cvc - The card CVC.
   * @param {number} data.card.exp_month - The card expiration month.
   * @param {number} data.card.exp_year - The card expiration year.
   * @param {string} data.session_id - The ID of the session.
   * @param {string} data.store_id - The ID of the store.
   *
   * @throws {Error} - If there is an error creating the payment token through the api.
   *
   * @returns {Promise<void>} A promise that resolves to the payment token.
   */
  async createPaymentToken(data) {
    let { data: paymentToken } = await this.client.post(`/carts/payment_tokens`, {
      ...data,
      cart_token: this.overhub_store.cart_token,
    });
    this.overhub_store.setPaymentToken(paymentToken.token);
  }

  async saveContact(data) {
    let { data: prospect } = await this.client.patch(`/prospects`, {
      shipping_contact: data.shipping_contact,
      billing_contact: data.billing_contact,
      session: this.overhub_store.session,
      store_id: this.overhub_store.store_id,
    });
    this.overhub_store.setProspect(prospect);
  }

  /**
   * saveProspect
   * this will update a prospect, it's contacts, and it's session
   *
   * @param {object} data
   * @param {object} [data.user] - the user object
   * @param {string} [data.user.id] - the id of the user
   * @param {string} [data.user.email] - the email of the user
   * @param {object} [data.billing_contact]
   * @param {string} [data.billing_contact.first_name]
   * @param {string} [data.billing_contact.last_name]
   * @param {string} [data.billing_contact.address_1]
   * @param {string} [data.billing_contact.address_2]
   * @param {string} [data.billing_contact.city]
   * @param {string} [data.billing_contact.state]
   * @param {string} [data.billing_contact.postal_code]
   * @param {object} [data.shipping_contact]
   * @param {string} [data.shipping_contact.first_name]
   * @param {string} [data.shipping_contact.last_name]
   * @param {string} [data.shipping_contact.address_1]
   * @param {string} [data.shipping_contact.address_2]
   * @param {string} [data.shipping_contact.city]
   * @param {string} [data.shipping_contact.state]
   * @param {string} [data.shipping_contact.postal_code]
   */
  async saveProspect(data) {
    let { data: prospect } = await this.client.patch(`/prospects`, {
      ...data,
      session: { id: this.overhub_store.session?.id, ...data.session },
      store_id: this.overhub_store.store_id,
    });

    this.overhub_store.setProspect(prospect);
    this.clientPersist.setItem('prospect_id', prospect.id);

    return prospect;
  }

  /**
   * buildPaypalOrder
   * @param {string} [order_id]
   * @param {boolean} [is_post_sale=false]
   */
  async buildPaypalOrder(order_id, idempotent_key, is_post_sale = false) {
    let cart_id = this.overhub_store.cart.id;

    // new order req data
    let cartData = {
      billing_contact_id: this.overhub_store.billing_contact.id,
      cart_id,
      currency_iso: this.overhub_store.getConfig('currency_iso'),
      fail_url: `${location.origin}${this.getConfig('fail_url')}`,
      idempotent_key,
      order_id,
      payment_group_id: this.overhub_store.getConfig('payment_group_id_paypal'),
      return_url: `${location.origin}${this.getConfig('success_url')}`,
      session: this.overhub_store.session,
      shipping_contact_id: this.overhub_store.shipping_contact.id,
      store_id: this.overhub_store.store_id,
    };

    let data;

    debug.log('build paypal order : [order_id, is_post_sale] = ', order_id, is_post_sale);
    // If there is an order_id, then this is retrying a failed order or a post sale
    if (order_id) {
      // TODO@public_token: in the future, we can validate the public token on the client
      // if we want to add some convenience and weight to the client
      let patch_data = {
        cart_id,
        fail_url: `${location.origin}${this.getConfig('fail_url')}`,
        idempotent_key,
        payment_group_id: this.overhub_store.getConfig('payment_group_id_paypal'),
        public_token: this.overhub_store.public_token,
        return_url: `${location.origin}${this.getConfig('success_url')}`,
        store_id: this.overhub_store.store_id,
      };

      if (is_post_sale) {
        ({ data } = await this.client.post(`/carts/paypal_orders/postsale`, {
          ...patch_data,
          order_id,
        }));
      } else {
        // these fields are not allowed to be updated on the paypal order with a successful
        // funding attempt, so we need to add them to this attempt which is a retry of an initial, failed funding attempt
        // e.g. has order_id but is not a post sale
        let retry_data = {
          ...patch_data,
          billing_contact_id: this.overhub_store.billing_contact.id,
          shipping_contact_id: this.overhub_store.shipping_contact.id,
          currency_iso: this.overhub_store.getConfig('currency_iso'),
        };

        ({ data } = await this.client.patch(`/carts/paypal_orders/${order_id}`, retry_data));
      }
    } else {
      ({ data } = await this.client.post(`/carts/paypal_orders`, cartData));
      let { id: order_id, public_token } = data;
      this.clientPersist.setItem('public_token', public_token);
      this.clientPersist.setItem('order_id', order_id);
    }

    // grab the approve link from the paypal response
    let { approve_link } = data;
    let order = data.data.order;

    // store the order_id for the postsale page
    this.clientPersist.setItem('order_id', order.id);
    this.clientPersist.setItem('currency_iso', order.currency_iso);

    // redirect to the approve link
    window.location = approve_link;
  }

  /**
   * processCartOrder
   * takes the existing cart_id and processes the order
   *
   * @param {string} order_id - uuid of the order
   * @param {object} options
   * @param {string} options.intent - the intent of the order, either capture or build
   * @returns {object} - the object that is returned from the services/orders endpoint
   */
  async processCartOrder(order_id, options = {}) {
    let cart_id = this.overhub_store.cart.id;

    let data;

    // If there is an order_id, then this is retrying a failed order
    if (order_id) {
      let patch_data = {
        billing_contact_id: this.overhub_store.billing_contact.id,
        cart_id,
        currency_iso: this.overhub_store.getConfig('currency_iso'),
        idempotent_key: options.idempotent_key,
        payment_group_id: this.overhub_store.getConfig('payment_group_id'),
        payment_token: this.overhub_store.paymentToken,
        public_token: this.overhub_store.public_token,
        session: this.overhub_store.session,
        shipping_contact_id: this.overhub_store.shipping_contact.id,
        store_id: this.overhub_store.store_id,
      };
      ({ data } = await this.client.patch(`/carts/orders/process/${order_id}`, patch_data));
    } else {
      let create_data = {
        billing_contact_id: this.overhub_store.billing_contact.id,
        cart_id,
        currency_iso: this.overhub_store.getConfig('currency_iso'),
        idempotent_key: options.idempotent_key,
        payment_group_id: this.overhub_store.getConfig('payment_group_id'),
        payment_token: this.overhub_store.paymentToken,
        session: this.overhub_store.session,
        shipping_contact_id: this.overhub_store.shipping_contact.id,
        store_id: this.overhub_store.store_id,
      };
      ({ data } = await this.client.post(`/carts/orders/process`, create_data));

      let order = data.data.order;
      let { public_token } = data;
      // we need to set the order_id on the store in case this is a failed funding attempt
      // was this a successful funding attempt?
      if (data.data.payment_status === 'approved') {
        this.overhub_store.setOrderPaymentStatus('approved');
      } else {
        this.overhub_store.setOrderPaymentStatus('rejected');
      }

      this.overhub_store.public_token = public_token;
      this.overhub_store.setOrder(order);
      this.clientPersist.setItem('order_id', order.id);
      this.clientPersist.setItem('currency_iso', order.currency_iso);
      this.clientPersist.setItem('public_token', public_token);
    }

    return data;
  }

  async processPostSaleOrder(order_id, idempotent_key) {
    let cart_id = this.overhub_store.cart.id;
    let patch_data = {
      cart_id,
      currency_iso: this.overhub_store.getConfig('currency_iso'),
      idempotent_key,
      order_id,
      public_token: this.overhub_store.public_token,
      session: this.overhub_store.session,
      store_id: this.overhub_store.store_id,
    };
    let { data } = await this.client.post(`/carts/orders/postsale`, patch_data);

    return data;
  }

  /**
   * getNewOrderProjection
   * this will create a new order projection based on a cart
   * it will use the current cart, billing_contact, shipping_contact, and payment_token
   *
   * @param {object} [additionalData={}]
   *
   * @returns {Promise<{data: {order: {id: string}}}>}
   */
  async getNewOrderProjection(additionalData = {}) {
    let cart_id = this.overhub_store.cart.id;
    let { data } = await this.client.post(`/carts/order_projections`, {
      billing_contact_id: this.overhub_store.billing_contact.id,
      cart_id,
      order_id: additionalData.order_id,
      public_token: this.overhub_store.public_token,
      session: this.overhub_store.session,
      shipping_contact_id: this.overhub_store.shipping_contact.id,
      store_id: this.overhub_store.store_id,
    });

    this.overhub_store.order_projection = data.data;

    return data;
  }

  // REVIEW: this is not used, should probably be deleted
  /**
   *
   * @param {object} options
   * @param {string} options.return_url - the url to return to after the paypal redirect flow
   * @returns
   */

  async _hydrateFromPersistedStorage() {
    let order_id = this.clientPersist.getItem('order_id');
    if (order_id) {
      this.overhub_store.setOrderId(order_id);
    }

    let public_token = this.clientPersist.getItem('public_token');
    if (public_token) {
      this.overhub_store.public_token = public_token;
    }

    // hydrate the items that are synced into persisted storage and hydrate the store
    let is_debug = this.clientPersist.getItem('is_debug');
    if (is_debug) {
      this.overhub_store.is_debug = is_debug;
    }

    let debug_filters = this.clientPersist.getItem('debug_filters');
    if (debug_filters) {
      this.overhub_store.debug_filters = debug_filters;
    }
  }

  /**
   * hydrates the cart from the persisted storage
   *
   * @returns {Promise<void>}
   */
  async hydrateCartFromPersistedStorage() {
    let cart_id = this.clientPersist.getItem('cart_id');
    if (!cart_id) return;

    let cart_token = this.clientPersist.getItem('cart_token');
    this.overhub_store.setCartToken(cart_token);

    await this.loadCart(cart_id);
  }

  async _initializeProspect() {
    // Get UTM parameters
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    const utm_source = urlParams.get('utm_source');
    const utm_medium = urlParams.get('utm_medium');
    const utm_campaign = urlParams.get('utm_campaign');
    const utm_term = urlParams.get('utm_term');
    const utm_content = urlParams.get('utm_content');
    // get the 5 sub ids from the urlParams in the format subid_1, subid_2, etc
    const subid_1 = urlParams.get('subid_1');
    const subid_2 = urlParams.get('subid_2');
    const subid_3 = urlParams.get('subid_3');
    const subid_4 = urlParams.get('subid_4');
    const subid_5 = urlParams.get('subid_5');

    // Get browser information
    // TODO: this needs to be replaced with a user agent parser
    // I blindly accepted copilot's suggestion here
    const browser = {
      userAgent: window.navigator.userAgent,
      language: window.navigator.language,
      platform: window.navigator.platform,
      appName: window.navigator.appName,
      appVersion: window.navigator.appVersion,
      vendor: window.navigator.vendor,
    };

    // TODO: this should look for an existing prospect in the local storage

    await this.saveProspect({
      store_id: this.overhub_store.store_id,
      session: {
        referrer: location.href,
        store_id: this.overhub_store.store_id,
        subid_1,
        subid_2,
        subid_3,
        subid_4,
        subid_5,
        utm_campaign,
        utm_content,
        utm_medium,
        utm_source,
        utm_term,
      },
    });
  }
}

export default OverhubController;

export const useOverhubController = createGlobalState(() => {
  const router = useRouter();

  return OverhubController.getInstance(router);
});
