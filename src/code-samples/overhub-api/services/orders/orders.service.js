const Orders = require('./orders.class');
const hooks = require('./orders.hooks');
const db = require('../knex');

module.exports = function (app) {
  app.use(
    '/orders',
    new Orders({
      Model: db,
      name: 'orders',
    })
  );

  const ordersService = app.service('/orders');
  ordersService.hooks(hooks);
};
