require('./mock_kms')();

const _ = require('lodash');
const app = require('../app');
const StoreFactory = require('./factories/store.factory');

const {
  cleanDb,
  createApplicationUser,
  createPaymentConfiguration,
  createStore,
  Factory,
  restifarian,
  setupService,
} = require('./helpers');

const capturePath = `/payments/capture`;
setupService(app, '/payments/capture');
setupService(app, 'job_queues');
setupService(app, 'payments/paypal/orders');
setupService(app, 'fx');

const nmiClient = require('../plugins/payment/clients/nmi_client');
const stripeClient = require('../plugins/payment/clients/stripe_client');
const { Account } = require('../lib/objection_models/index');

describe('Overhub', () => {
  describe('Payments', () => {
    describe('Capture', () => {
      // a scoped placeholder for a partial func
      var createRequest;
      var resty;
      var applicationUser, invativeAccount, nmiPaymentGroup, stripePaymentGroup;

      beforeEach(async () => {
        await cleanDb();

        invativeAccount = await Account.query().findOne({ name: 'Invative Inc.' });
        applicationUser = await createApplicationUser(invativeAccount, app);
        let store = await createStore(invativeAccount, StoreFactory.build({ name: 'default' }));
        ({ payment_group: nmiPaymentGroup } = await createPaymentConfiguration(invativeAccount, store, {
          processorData: { type: 'nmi' },
        }));
        ({ payment_group: stripePaymentGroup } = await createPaymentConfiguration(
          invativeAccount,
          store,
          {
            processorData: { type: 'stripe' },
          }
        ));
      });

      beforeEach(async () => {
        resty = await restifarian(app, 'api_application', {
          id: applicationUser.email,
          key: 'rando',
        });

        createRequest = _.partial(resty.post, capturePath);
      });

      afterEach(async () => {
        let service = app.service('/job_queues');
        let { queue } = service;

        await queue.close();
      });

      describe('Validations', () => {
        let errors;

        async function doctorBadRequest(...fieldsToRemove) {
          let badReqBody = _.omit(Factory.build('captureRequest'), fieldsToRemove);
          let response = await resty.post(capturePath, badReqBody);
          let { statusCode, body } = response;
          expect(statusCode).toEqual(400);
          errors = body.errors;

          return response;
        }

        it('requires a payment group', async () => {
          await doctorBadRequest('payment_group_id');
          expect(errors.payment_group_id).toBeDefined();
        });

        it('requires idempotent key', async () => {
          await doctorBadRequest('idempotent_key');
          expect(errors.idempotent_key).toBeDefined();
        });

        // TODO: re-enable these validation tests
        // it requires more refactoring in test setup around the payment groups
        // at this time, the effort is not worth it.
        xdescribe('Credit Card', () => {
          const card = {
            number: 4111111111111111,
            exp_month: 12,
            exp_year: 2026,
            cvc: 123,
          };

          // TODO: enable exp_month test. For some reason it's triggering a deadlock only in test env
          ['number', 'exp_year', 'cvc'].forEach((cardProperty) => {
            it(`requires a ${cardProperty}`, async () => {
              let badRequest = Factory.build('captureRequest', {
                card: _.omit(card, [cardProperty]),
              });
              let { body } = await createRequest(badRequest);
              let { errors } = body;
              let property = `card,${cardProperty}`;
              expect(errors[property]).toBeDefined();
            });
          });

          it.todo('does not require a card if the processor type is paypal');
        });

        describe('When an order is defined', () => {
          // TODO: re-enable once order refactor complete
          xit('requires an order id', async () => {
            let badOrderRequest = Factory.build('captureRequest');
            badOrderRequest.order = {};
            let response = await createRequest(badOrderRequest).expect(400);
            let errors = response.body.errors;
            expect(errors['order,id']).toBeDefined();
            expect(Object.keys(errors)).toEqual(['order,id']);
          });
        });
      });

      describe('NMI', () => {
        var captureReqBody;

        // TODO: need to add a store_id to the request
        beforeEach(async () => {
          captureReqBody = Factory.build('captureRequest', {
            payment_group_id: nmiPaymentGroup.slug,
            store_id: nmiPaymentGroup.store_id,
          });
        });

        it('captures the payment', async () => {
          let { statusCode } = await createRequest(captureReqBody);
          expect(statusCode).toEqual(201);
          expect(nmiClient.capture).toHaveBeenCalled();
        });

        it('informs of a duplicate transaction', async () => {
          let { statusCode } = await createRequest(captureReqBody);

          expect(statusCode).toEqual(201);

          let { statusCode: dupeStatusCode, body } = await createRequest(captureReqBody);
          expect(dupeStatusCode).toEqual(200);
          expect(body.message).toBe('Duplicate Transaction attempted. Returning prior results');
        });
      });

      describe('Stripe', () => {
        it('captures the payment', async () => {
          let captureReqBody = Factory.build('captureRequest', {
            payment_group_id: stripePaymentGroup.slug,
            store_id: stripePaymentGroup.store_id,
          });

          let { statusCode } = await createRequest(captureReqBody);
          expect(statusCode).toEqual(201);
          expect(stripeClient).toHaveBeenCalled();
        });
      });
    });
  });
});
