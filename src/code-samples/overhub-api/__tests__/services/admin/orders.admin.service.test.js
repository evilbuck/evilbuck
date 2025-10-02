const _ = require('lodash');
const { v4: uuid } = require('uuid');
const {
  cleanDb,
  restifarian,
  Factory,
  createUserRole,
  createAccount,
  createPermission,
  createUser,
  createStore,
  itBehavesLikeAProtectedRoute,
  DI,
} = require('../../helpers');
const StoreFactory = require('../../factories/store.factory');
const CustomerFactory = require('../../factories/customer.factory');
const SessionFactory = require('../../factories/session.factory');
const NoteFactory = require('../../factories/note.factory');

const app = require('../../../app');
const { Account, Product, UserResource, Variant } = require('../../../lib/objection_models/index');

describe('Overhub', () => {
  describe('Services', () => {
    describe('Admin', () => {
      describe('Orders', () => {
        var account, user, store, resty, routeResource, userRole, product, variant, order, customer;
        var differentAccount,
          differentUser,
          differentAccountProduct,
          differentAccountOrder,
          differentAccountSession,
          differentAccountCustomer,
          differentAccountContact;
        let password = 'test';

        beforeEach(async () => {
          await cleanDb();

          account = await Account.query().findOne({ name: 'Invative Inc.' });
          store = await createStore(account, StoreFactory.build({ name: 'default' }));
          // REVIEW@catalogs: CAT-31: Order items are built up here for this series of tests. Needs to be refactored to account for new relationships.
          product = await account
            .$relatedQuery('products')
            .insert(Factory.build('product'))
            .returning('*');
          product = await Product.query().findById(product.id);

          user = await createUser(account, Factory.build('userWithLogin', { password }), app);
          userRole = await createUserRole(account, user, { name: 'test role' });

          customer = await account.$relatedQuery('users').insert(CustomerFactory.build());

          variant = await product
            .$relatedQuery('variants')
            .insert(Factory.build('variant'))
            .returning('*');
          // re-fetch to coerce the values
          variant = await Variant.query().findById(variant.id);

          order = await account
            .$relatedQuery('orders')
            .insert(Factory.build('order', { customer_id: customer.id }));

          // a different user
          differentAccount = await createAccount('different account');
          differentUser = await createUser(differentAccount, Factory.build('user', { password }), app);
          await differentAccount.$relatedQuery('stores').insert({ name: 'default' });
          differentAccountProduct = await differentAccount
            .$relatedQuery('products')
            .insert(Factory.build('product'));
          await differentAccountProduct.$relatedQuery('variants').insert(Factory.build('variant'));
          differentAccountOrder = await differentAccount
            .$relatedQuery('orders')
            .insert(Factory.build('order'));
          differentAccountSession = await differentAccount
            .$relatedQuery('sessions')
            .insert(SessionFactory.build());
          await differentAccount
            .$relatedQuery('notes')
            .insert(NoteFactory.build({ user_id: differentUser.id }));
          differentAccountCustomer = await differentAccount
            .$relatedQuery('customers')
            .insert(CustomerFactory.build());
          differentAccountContact = await differentAccountCustomer
            .$relatedQuery('contacts')
            .insert(Factory.build('contact'));

          // route resources
          routeResource = await UserResource.query().insert({ name: 'admin/orders' }).returning('*');
        });

        // setup authenticated resty
        beforeEach(async () => {
          resty = await restifarian(app, 'user', {
            email: user.email,
            password,
          });
          DI.set('resty', resty);
        });

        itBehavesLikeAProtectedRoute('resty', `/orders`, {}, { omitted: ['update'] });
        describe('authorized routes', () => {
          beforeEach(async () => {
            await createPermission(userRole, routeResource, { access: 'get' });
            await createPermission(userRole, routeResource, { access: 'patch' });
            await createPermission(userRole, routeResource, { access: 'create' });
            await createPermission(userRole, routeResource, { access: 'find' });
          });

          describe('without account access', () => {
            it('orders.get', async () => {
              let { body, statusCode } = await resty.get(`/admin/orders/${differentAccountOrder.id}`);
              expect(statusCode).toEqual(403);
              expect(body.message).toContain(`You do not have access to this account`);
            });

            describe('orders.patch', () => {
              it('when the order belongs to a different account', async () => {
                let { body, statusCode } = await resty.patch(
                  `/admin/orders/${differentAccountOrder.id}`,
                  {
                    tax_is_included: true,
                  }
                );
                expect(statusCode).toEqual(403);
                expect(body.message).toContain(`You do not have access to this account`);
              });

              describe('Sessions', () => {
                it('when the session belongs to another customer', async () => {
                  let differentCustomer = await account
                    .$relatedQuery('customers')
                    .insert(Factory.build('user', { type: 'customer' }));

                  let session = await differentCustomer
                    .$relatedQuery('sessions')
                    .insert(SessionFactory.build({ account_id: account.id }));

                  let { body, statusCode } = await resty.patch(`/admin/orders/${order.id}`, {
                    session_id: session.id,
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('session does not belong to this customer');
                });

                it('when the session_id provided belongs to a different account', async () => {
                  let { body, statusCode } = await resty.patch(`/admin/orders/${order.id}`, {
                    session_id: differentAccountSession.id,
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(`You do not have access to this account`);
                  expect(body.message).toContain(`The session is out of scope`);
                });
              });

              describe('when the contact does not belong to the customer', () => {
                let differentCustomer, differentCustomerContact;

                beforeEach(async () => {
                  differentCustomer = await createUser(
                    account,
                    Factory.build('user', { type: 'customer' }),
                    app
                  );
                  differentCustomerContact = await differentCustomer
                    .$relatedQuery('contacts')
                    .insert(Factory.build('contact'));
                });

                it('billing contact', async () => {
                  let { body, statusCode } = await resty.patch(`/admin/orders/${order.id}`, {
                    idempotent_key: `order-${uuid()}`,
                    billing_contact: { id: differentCustomerContact.id, first_name: 'negativeMcTest' },
                    intent: 'build',
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(
                    'The billing contact is out of scope for this customer'
                  );
                });

                it('shipping contact', async () => {
                  let { body, statusCode } = await resty.patch(`/admin/orders/${order.id}`, {
                    idempotent_key: `order-${uuid()}`,
                    shipping_contact: { id: differentCustomerContact.id, first_name: 'negativeMcTest' },
                    intent: 'build',
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(
                    'The shipping contact is out of scope for this customer'
                  );
                });
              });

              describe('Customer', () => {
                it('when a customer does not belong to the account', async () => {
                  let { body, statusCode } = await resty.patch(`/admin/orders/${order.id}`, {
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    customer: {
                      id: differentAccountCustomer.id,
                      name: 'badtest',
                    },
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('You do not have access to this account');
                  expect(body.message).toContain('Customer is out of scope');
                });
              });
            });

            describe('orders.create', () => {
              describe('Sessions', () => {
                it('when the session belongs to another customer', async () => {
                  let differentCustomer = await account
                    .$relatedQuery('customers')
                    .insert(Factory.build('user', { type: 'customer' }));

                  let session = await differentCustomer
                    .$relatedQuery('sessions')
                    .insert(SessionFactory.build({ account_id: account.id }));

                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    session: { id: session.id, subid_1: 'fake test' },
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    customer: { id: customer.id },
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('session does not belong to this customer');
                });

                it('when the session_id provided belongs to a different account', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    session: {
                      id: differentAccountSession.id,
                      subid_1: 'madeup',
                    },
                    intent: 'build',
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(`You do not have access to this account`);
                  expect(body.message).toContain(`The session is out of scope`);
                });
              });

              describe('when the contact does not belong to the customer', () => {
                let differentCustomer, differentCustomerContact;

                beforeEach(async () => {
                  differentCustomer = await createUser(
                    account,
                    Factory.build('user', { type: 'customer' }),
                    app
                  );
                  differentCustomerContact = await differentCustomer
                    .$relatedQuery('contacts')
                    .insert(Factory.build('contact'));
                });

                it('billing contact', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    billing_contact: { id: differentCustomerContact.id, first_name: 'negativeMcTest' },
                    intent: 'build',
                    customer_id: customer.id,
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(
                    'The billing contact is out of scope for this customer'
                  );
                });

                it('billing contact data.customer_id directly specified', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    billing_contact_id: differentCustomerContact.id,
                    intent: 'build',
                    customer_id: customer.id,
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(
                    'The billing contact is out of scope for this customer'
                  );
                });

                it('shipping contact data.shipping_contact_id directly specified', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    shipping_contact_id: differentCustomerContact.id,
                    intent: 'build',
                    customer_id: customer.id,
                  });
                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain(
                    'The shipping contact is out of scope for this customer'
                  );
                });
              });

              describe('when a contact does not belong to the account', () => {
                it('shipping_contact', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    shipping_contact: { id: differentAccountContact.id },
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('shipping contact is out of scope for this account');
                });

                it('shipping_contact_id', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    shipping_contact_id: differentAccountContact.id,
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('shipping contact is out of scope for this account');
                });

                it('billing_contact', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    billing_contact: { id: differentAccountContact.id },
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('billing contact is out of scope for this account');
                });

                it('billing_contact_id', async () => {
                  let { body, statusCode } = await resty.post(`/admin/orders`, {
                    idempotent_key: `order-${uuid()}`,
                    intent: 'build',
                    billing_contact_id: differentAccountContact.id,
                  });

                  expect(statusCode).toEqual(403);
                  expect(body.message).toContain('billing contact is out of scope for this account');
                });
              });
            });
          });

          describe('orders.find', () => {
            // REVIEW@tests: We need to rethink this. If we require a
            // `store_id` to be supplied to the endpoint, then we need to
            // ensure the that the api user has access to the store. In the
            // case where the user doesn't have access, we should return a 403.
            // The only way this test would work is if we fetched a list of
            // all stores that the user has access to, and then supply those
            // as part of a whereIn clause on the query.
            xit('returns only the orders that I can access', async () => {
              let { body, statusCode } = await resty.get(`/admin/orders?store_id=${store.id}`);

              expect(statusCode).toEqual(200);
              expect(_.map(body, 'id')).not.toContain(differentAccountOrder.id);
            });
          });
        });
      });
    });
  });
});
