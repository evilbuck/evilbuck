const { cleanDb } = require('../helpers');
const { Factory } = require('rosie');

const { Model } = require('objection');
const knex = require('../../services/knex');
Model.knex(knex);
const feathers = require('@feathersjs/feathers');
const app = feathers();
const configuration = require('@feathersjs/configuration');
app.configure(configuration());
app.configure(require('../../services/users/users.service'));
app.configure(require('../../services/api_applications/api_applications.service'));
app.configure(require('../../services/admin/users/users.service'));
const { configure: configureAuthentication } = require('../../services/authentication_service');
app.configure(configureAuthentication);
app.configure(require('../../services/user_authentication/user_authentication.service'));
const { authenticateJwt } = require('../../services/hooks');
const { NotAuthenticated, Forbidden } = require('@feathersjs/errors');

const { User } = require('../../lib/objection_models/index');

class AuthenticatedService {
  async find() {
    return { authenticate: true };
  }
}

app.use('authenticated_service', new AuthenticatedService());

app.service('authenticated_service').hooks({
  before: {
    find: [authenticateJwt],
  },
});

describe('Overhub', () => {
  describe('Authentication', () => {
    beforeEach(async () => {
      await cleanDb();
    });

    describe('Without a token at all', () => {
      it('rejects if not authenticated with not authenticated error', async () => {
        return app
          .service('authenticated_service')
          .find({ provider: 'test' })
          .then((result) => {
            expect(result).not.toBe();
          })
          .catch((error) => {
            expect(error).toBeInstanceOf(NotAuthenticated);
          });
      });
    });

    describe('With a jwt', () => {
      var accessToken, apiToken;

      beforeEach(async () => {
        let result = await app.service('/authentication').create({
          id: '80ec37f4-9abb-40c3-b7c2-20120eed6600',
          key: 'rando',
          strategy: 'local',
        });

        apiToken = accessToken = result.accessToken;
      });

      describe('Authentication', () => {
        var user, userData, userAccessToken, csRepUserData, csRepUser;
        const userIds = [];

        beforeEach(async () => {
          // create a user
          userData = Factory.build('userWithLogin', { password: 'test123' });

          user = await app.service('/users').create(userData, {
            authentication: { strategy: 'jwt', accessToken },
          });
          userIds.push(user.id);

          // create a role
          let [adminRole] = await knex('roles').insert({ name: 'admin' }).returning('*');

          let [authenticatedResource] = await knex('resources')
            .insert({
              name: 'authenticated_service',
              description: 'An arbitrary authenticated service resource just for this test',
            })
            .returning('*');
          // assign a role to a user
          await knex('roles_users').insert({ user_id: user.id, role_id: adminRole.id });

          try {
            // assign some resources to the role
            await knex('permissions').insert({
              role_id: adminRole.id,
              access: 'find',
              resource_id: authenticatedResource.id,
            });
          } catch (error) {
            console.error('permissions insert', error);
          }

          csRepUserData = Factory.build('userWithLogin', { password: 'test123' });
          csRepUser = await app.service('/users').create(csRepUserData, {
            authentication: { strategy: 'jwt', accessToken },
          });
          userIds.push(csRepUser.id);
          await knex('roles').insert({ name: 'csrep' }).returning('*');

          try {
            let userLogin = await app.service('/user_authentication').create({
              strategy: 'local',
              email: userData.email,
              password: userData.password,
            });
            userAccessToken = userLogin.accessToken;
            accessToken = userLogin.accessToken;
          } catch (error) {
            console.error('user login error', error);
            throw error;
          }
        });

        afterEach(async () => {
          await User.query().delete().whereIn('id', userIds);
        });

        it('authenticates with a proper token', async () => {
          let result = await app.service('authenticated_service').find({
            provider: 'jest',
            authentication: { strategy: 'jwt', accessToken: apiToken },
          });
          expect(result).toEqual({ authenticate: true });
        });

        describe('Authorization', () => {
          var accessToken;
          describe('Unauthorized', () => {
            beforeEach(async () => {
              let userLogin = await app.service('/user_authentication').create({
                strategy: 'local',
                email: csRepUser.email,
                password: csRepUserData.password,
              });
              accessToken = userLogin.accessToken;
            });

            it('User is denied access when the right authority is not granted', async () => {
              try {
                let { body, statusCode } = await app.service('authenticated_service').find({
                  provider: 'rest',
                  authentication: { strategy: 'jwt', accessToken },
                });
                expect(true).toBe(false);
              } catch (error) {
                expect(error).toBeInstanceOf(Forbidden);
              }
            });
          });
        });
      });
    });
  });
});
