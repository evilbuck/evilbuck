import _ from 'lodash';

import { createSelectPackageStrategy } from '../lib/package_select_strategies/index.js';
import { defineStore } from 'pinia';
import debug from '../lib/debug.js';
import Publisher from '../lib/publisher.js';

/**
 * @typedef {Object} PackageItem
 * @property {string} id
 * @property {string} catalog_id
 * @property {string} product_id
 * @property {string} variant_id
 * @property {string} name
 * @property {?string} description
 * @property {string} currency_iso
 * @property {string} price
 * @property {string} created_at
 * @property {string} updated_at
 * @property {boolean} is_deleted
 * @property {?string} deleted_at
 * @property {boolean} is_archived
 * @property {?string} archived_at
 * @property {string} sku
 * @property {number} quantity
 * @property {string} package_price
 */

/**
 * @typedef {Object} DisplayMeta
 * @property {number} sort
 * @property {boolean} best_choice
 * @property {string} package_selector_image
 */

/**
 * @typedef {Object} Options
 * @property {string[]} sizes
 * @property {string[]} colors
 * @property {string} currency_iso
 * @property {string} package_type
 * @property {string} price_strategy
 */

/**
 * @typedef {Object} Package
 * @property {string} id
 * @property {string} store_id
 * @property {string} name
 * @property {string} package_group
 * @property {string} slug
 * @property {Options} options
 * @property {DisplayMeta} display_meta
 * @property {string} created_at
 * @property {string} updated_at
 * @property {boolean} is_deleted
 * @property {?string} deleted_at
 * @property {PackageItem[]} package_items
 */

export default defineStore('overhub', {
  state: () => ({
    availablePackages: [],
    billing_contact: {},
    card: {},
    cart: { cart_items: [] },
    cart_token: null,
    cartItems: [],
    catalogItems: [],
    // these configuration values are defaults and can be overridden by the user
    // e.g. right after the bootstrap script is loaded: _OH_.set('order_summary_selector', '#my-custom-order-summary-container')
    configuration: {
      api_key: null,
      order_summary_selector: '#order-summary-container',
      currency_iso: '',
      payment_form_selector: '#payment-form-container',
      package_container_selector: '#packages-collection-container',
      package_type: 'silky_family',
      package_template_selector: '#package-template',
      select_package_strategy: 'BEST-CHOICE',
      post_sale_component_selector: '#post-sale-template',

      // pages
      package_select_page_url: /^\/$|^\/index\.html$/,
      post_sale_page_url: '/post_sale.html',
      // thank_you_page_url: '/thank-you',
      // NOTE: this is a regex to match the thank you page url for the possible variations in
      // development and webflow
      thank_you_page_url: /^\/thank\-you|thank_you.html|thankyou/,
      // this is where the user should be redirected to after a failed post sale
      // they'll be shown an error message and a link to go to this page during a post sale failure
      post_fail_url: '/post_fail.html',

      // selectors
      selectors: {
        // TODO: change the default to #color-selector-container
        // need to refactor the current template selectors
        color_filter_selector: '#color-selector-container-2',
        contact_form_selector: '#contact-form-container',
        error_modal_selector: '#error-modal-container',
        order_summary: {
          order_summary_selector: '#order-summary',
          order_summary_total_amount_selector: '.oh-total_amount',
          order_summary_subtotal_amount_selector: '.oh-subtotal_amount',
          order_summary_sales_tax_amount_selector: '.oh-sales_tax_amount',
          order_summary_shipping_amount_selector: '.oh-shipping_amount',
          post_sale_order_summary_selector: '#order-summary',
        },
        package_collection_filter_selector: '#packages-collection-container',
        package_selector_component: {
          savings_percentage_selector: '.savings_percentage',
          title_selector: '.title',
          image_selector: '.oh-image',
          price_selector: '.oh-price',
          currency_selector: '.currency',
        },
        shopping_cart_selector: '#shopping-cart-container',
        // TODO@config: change the default to something better than this for f's sake
        size_filter_selector: '#size-selector-container',
        thank_you_page: {
          order_summary: '.thankyou-order-summary',
        },
      },
    },
    customer: {},
    /** @type {string} */
    // This token is used to verify the end user has access to the order
    // used on the post sale page
    debug_filters: [],
    is_debug: false,
    isLoading: false,
    modal: {
      is_visible: false,
      message: null,
      link: null,
    },
    // store_id: null,
    name: 'Name 1',
    notifications: [],
    order_id: null,
    order_projection: {},
    order: {},
    package_filters: [],
    payment_status: null,
    prospect: {},
    public_token: null,
    publisher: new Publisher(),
    session: {},
    shipping_contact: {},
    state: {},
    test_last_name: 'initial test last name value',
  }),

  actions: {
    getSelector(selector) {
      return this.getConfig(`selectors.${selector}`);
    },

    /**
     * finds a collection item by slug
     * this collection is populated by webflow collections and a custom embed script in wf
     *
     * @param {Package} pkg - the package to find the collection item for
     * @returns {Object|undefined}
     */
    getPackageCollectionItem: _.memoize(
      (pkg) => {
        if (!Array.isArray(window.packages_collection)) {
          console.warn('window.packages_collection is not an array');
          return undefined;
        }
        // const matchBySlugStrategy = (item) => item.slug === pkg.slug;
        const matchByPackageTypeAndQuantityStrategy = (item) => {
          return item.package_type === pkg?.options?.package_type;
        };

        return window.packages_collection.find(matchByPackageTypeAndQuantityStrategy);
      },
      (pkg) => pkg
    ),

    setSelector(selector, value) {
      return this.setConfig(`selectors.${selector}`, value);
    },

    recordError(error) {
      console.error('recordError', error);
      // convert the error to a notification to be displayed to the user
      let notification = {
        message: error.message,
      };
      // add to the list of notifications
      this.notifications.push(notification);

      // remove the notification after 5 seconds
      setTimeout(() => {
        this.notifications.splice(this.notifications.indexOf(notification), 1);
      }, 5000);

      // TODO@pinia: we should subscribe to the actions to publish this
      // NOTE: right now there aren't any listeners
      // this.publisher.trigger('error', error);
    },

    setCart(cart) {
      this.cart = cart;
      if (Array.isArray(cart.cart_items)) {
        this.setCartItems(cart.cart_items);
      }
    },

    setCartToken(cart_token) {
      this.cart_token = cart_token;
    },

    /**
     * setCartItems
     * @param {Array} cartItems - an array of cart items
     */
    setCartItems(cartItems) {
      this.cartItems = cartItems;
    },

    setIsLoading(isLoading) {
      this.isLoading = isLoading;
    },

    setConfig(property, value) {
      _.set(this.configuration, property, value);
    },
    getConfig(property) {
      return _.get(this.configuration, property);
    },

    setOrder(order) {
      this.order = order;
      this.setOrderId(order.id);
    },

    /**
     *
     * @param {'approved|declined'} status
     */
    setOrderPaymentStatus(status) {
      this.payment_status = status;
    },

    addCatalogItem(item) {
      this.catalogItems.push(item);
    },

    /**
     * registerPackageFilter
     * stores the filter in the package_filters array
     *
     * @param {object} filter
     * @param {string} filter.name - the name of the filter
     * @param {string} filter.operator - the operator to use when filtering
     * @param {any} [filter.default] - the default value to use when filtering
     */
    registerPackageFilter(filter) {
      if (filter.default) {
        this.setFilter(filter.name, filter.default);
      }

      this.package_filters.push(filter);
    },

    selectPackage({ package_type }, options = {}) {
      // check if we have a previously selected package id that would get set by checking for an error condition
      // to maintain the state of the cart
      // during page initialization we don't have a selected package id UNLESS the error initializer is run

      let strategy_name = options.select_package_strategy ?? this.getConfig('select_package_strategy');
      let selectPackageStrategy = createSelectPackageStrategy(strategy_name);

      return selectPackageStrategy(this.filteredPackages, {
        package_type,
        ...options,
      });
    },

    getFilter(path) {
      return this.getConfig(path);
    },

    setFilter(path, value) {
      this.setConfig(path, value);
      // NOTE: this should be changed to be namespaced to a filters path
      // but cannot yet. There is a dependency on the filters being set on the configuration
      // for now
      // this.setConfig(`filters.${path}`, value);
    },

    closeModal() {
      this.modal = {};
    },

    /**
     * sets the modal message and shows the modal
     * optionally set a link to go to
     *
     * @param {object} options
     * @param {string} options.message - the message to display in the modal
     * @param {object} [options.link]
     * @param {string} [options.link.url] - the link to go to when the modal is closed
     * @param {string} [options.link.text] - the text to display on the link
     */
    displayModal({ message, link }) {
      this.modal = { message, link, is_visible: true };
    },

    setOrderId(id) {
      this.order_id = id;
    },

    setPaymentToken(paymentToken) {
      this.paymentToken = paymentToken;
    },

    setProspect(prospect) {
      this.prospect = prospect;
      let { billing_contact, session, shipping_contact } = prospect.relationships;
      if (session?.data) {
        this.setSession(session.data);
      }

      if (shipping_contact?.data) {
        this.setContact(shipping_contact.data);
      }

      if (billing_contact?.data) {
        this.setContact(billing_contact.data);
      }
    },

    setSelectedPackageId(id) {
      this.setConfig('selectedPackageId', id);
    },

    setSession(session) {
      this.session = session;
      // TODO@pinia: enable persisted storage
      // this.persistedStorage.setItem('session_id', session.id);
    },

    setContact(contact) {
      this[`${contact.type}_contact`] = contact;
    },
  },

  getters: {
    filteredPackages(state) {
      let packages_collection = window.packages_collection ?? [];
      // get the registered filters
      let filters = this.package_filters;
      return filters
        .reduce((packages, filter) => {
          // since the values can be stored on the options or the package itself, is is the case with package_group
          // we need to check both

          function getPackageValue(pkg) {
            return pkg[filter.name] ?? pkg.options?.[filter.name];
          }

          let filterFn;
          switch (filter.operator) {
            case 'includes':
              filterFn = (pkg) => (getPackageValue(pkg) ?? []).includes(this.getConfig(filter.name));
              break;
            // same as case 'eq':
            default:
              filterFn = (pkg) => getPackageValue(pkg) === this.getConfig(filter.name);
          }

          return packages.filter((pkg) => {
            return filterFn(pkg);
          });
        }, this.availablePackages)
        .map((pkg) => {
          // find the associated collection item
          let package_collection_item = this.getPackageCollectionItem(pkg);

          // Just in case the package_collection_item is not found, return the package without
          // the extended meta
          if (!package_collection_item) {
            debug.warn(
              'PackageCollectionWebComponent: no package_collection_item found for',
              pkg.slug,
              `this usually means that the webflow collection is missing the item or the slug was
            not input correctly`
            );
            return pkg;
          }

          // loop through all the package_collection_item properties and decode the html entities
          // It seems that the webflow api is returning the html entities encoded
          Object.keys(package_collection_item).forEach((key) => {
            package_collection_item[key] = _.unescape(package_collection_item[key]);
          });
          // add the extended meta to the package
          return Object.assign({}, pkg, { extended_meta: package_collection_item });
        });
    },

    selectedPackage(state) {
      return this.availablePackages.find((pkg) => pkg.id === this.getConfig('selectedPackageId'));
    },

    // NOTE: this getter only exists to work with existing direct references to the overhub_store.store_id
    // which was set during the store initialization with an environment variable, but this will
    // not work with an actual production deployment.
    // We don't support setting the store_id directly on the root of the store from the minimal
    // bootstrapped OH object and likely never will.
    // we should change direct references to the store_id to use getConfig('store_id') instead
    // and remove this getter
    store_id(state) {
      return this.getConfig('store_id');
    },

    order_shipping_contact(state) {
      return this?.order?.shipping_contact;
    },

    cartSummary(state) {
      let total = Math.round(
        state.cart.cart_items.reduce((total, item) => {
          return total + parseFloat(item.price) * item.quantity;
        }, 0)
      );
      return {
        sales_tax: 0,
        shipping_method: 'USPS',
        // NOTE: we don't have enough information to calculate the shipping total
        // we would need to add support to the cart items for shipping in the api
        // so we hard code it here
        shipping_total: 0,
        total,
      };
    },
  },
});
