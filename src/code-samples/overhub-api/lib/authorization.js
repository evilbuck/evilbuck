const _ = require('lodash');
const { rulesToQuery, rulesToAST } = require('@casl/ability/extra');
const { CompoundCondition } = require('@ucast/core');
const { interpret } = require('@ucast/sql/objection');
const { AbilityBuilder, Ability, subject } = require('@casl/ability');
const User = require('./objection_models/users.objection');
const { Forbidden } = require('@feathersjs/errors');

// logging support for debugging
const createWinstonLogger = require('./logging/winston_factory');
const createTransports = require('./logging/winston_transport_factory');
const logger = createWinstonLogger({
  transports: createTransports({ serviceName: 'authz-ability' }),
});

class OAbility {
  constructor(builder) {
    this.builder = builder;
    this.ability = builder.build();

    this.debug = false;
    let { DEBUG_AUTHZ } = process.env;
    if (DEBUG_AUTHZ == true || DEBUG_AUTHZ == 'true' || DEBUG_AUTHZ == 1) {
      this.debug = true;
    }
  }

  can(action, subject) {
    let canResult = this.ability.can(action, subject);
    if (this.debug) {
      logger.info({ log_type: 'ability', action, subject, result: canResult });
    }

    return canResult;
  }

  cannot(action, subject) {
    let cannotResult = this.ability.cannot(action, subject);
    if (this.debug) {
      logger.info({ log_type: 'ability', action, subject, result: cannotResult });
    }

    return cannotResult;
  }

  toFeathersQuery(action, subject) {
    return toFeathersQuery(this.ability, action, subject);
  }
}

/**
 * toObjectionQuery
 * builds a query to scope an entity by access defined in a casl ability
 *
 * @param {*} ability
 * @param {String} action
 * @param {*} query
 * @returns {object} - Objection Query
 */
function toObjectionQuery(ability, action, query, subject) {
  let ruleSubject = subject ?? query.modelClass().name;
  // REVIEW: we may want to use query.modelClass for reusability. Need to test more and get it working
  const rules = rulesToQuery(ability, action, ruleSubject, (rule) => {
    if (!rule.ast) {
      throw new Error('Unable to create Objection.Query without AST');
    }

    let ast = { ...rule.ast };

    return ast;
  });

  if (_.isEmpty(rules)) {
    return query;
  }

  // NOTE: $and rules are produced from inverted rules
  const { $and = [], $or = [] } = rules;
  let conditions = [];
  // this is the explicitly allowed (whitelist)
  if (!_.isEmpty($or)) {
    conditions = conditions.concat($or);
  }

  // TODO@authorization: need to test this condition
  // this is the explicitly denied (blacklist)
  if (!_.isEmpty($and)) {
    conditions.push(
      // REVIEW@authorization: this doesn't look right. shouldn't it be new CompoundCondition('not', invertedRule)) ?
      new CompoundCondition(
        'and',
        $and.map((invertedRule) => new CompoundCondition('not', $and))
      )
    );
  }

  const condition = new CompoundCondition('and', conditions);

  return interpret(condition, query);
}

async function compileRbacAbility(user_id) {
  const builder = new AbilityBuilder(Ability);
  const { can } = builder;

  let user = await User.query().findById(user_id).withGraphFetched('roles.[resources]');

  can('access', 'Account', { id: user.account_id });
  let { roles } = user;
  roles.forEach((role) => {
    role.resources.forEach((resource) => {
      // NOTE@authorize: rbac; a resource, an action, and optional conditions that resource must meet
      can(resource.access, resource.name, resource.conditions ?? null);
    });
  });

  return new OAbility(builder);
}

function handleBelongsToAccount(ability, account, message = '') {
  if (ability.cannot('access', account)) {
    throw new Forbidden(`You do not have access to this account ${message}`);
  }
}

function handleBelongsToStore(ability, store, message = '') {
  if (ability.cannot('access', subject('stores', { id: store.id }))) {
    throw new Forbidden(`You do not have access to this store ${message}`);
  }
}

function handleHasAbility(ability) {
  if (!ability) {
    throw new Forbidden(
      `No Permissions Found. Please talk to an administrator about getting Overhub permissions added to your account`
    );
  }
}

/**
 * Given an AST from a CASL ability, return an aggregated AST with fields that
 * are flattened into a single array.
 *
 * @param {object} ast - AST from casl created with `ability.rulesToAST`
 * @returns {object} - AST with conditions aggregated
 */
function aggregateAST(ast) {
  return ast.reduce((acc, rule) => {
    if (['eq', 'in', 'ne', 'nin', 'gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
      const { operator, field, value } = rule;

      // DOCS: When an unknown operator type is encountered, the AST will capture
      // it as an `eq` operator with an object as the value. For now, we are only
      // supporting the standard set of operators that are compatible with both
      // the CASL MongoQuery interface and the Feathers Query interface.
      // i.e. `$eq, $in, $ne, $nin, $gt, $gte, $lt, $lte`
      if (operator === 'eq' && _.isPlainObject(value)) return acc;

      let op = operator;

      // DOCS: We are converting `eq` and `ne` to `in` and `nin` respectively in
      // order to optimize the query by reducing the number of comparisons and
      // ensuring that indexes are used where they are available.
      if (['eq', 'in'].includes(op)) {
        op = 'in';
      }
      if (['ne', 'nin'].includes(op)) {
        op = 'nin';
      }

      let compoundKey = `${field}_${op}`;
      if (!acc[compoundKey]) {
        acc[compoundKey] = { field: field, operator: op, value: [] };
      }

      acc[compoundKey].value = acc[compoundKey].value.concat(value);
    }

    return acc;
  }, {});
}

/**
 * Given an ability, build and return a feathers query that can be used to
 * scope an entity by access defined in a CASL Ability.
 *
 * @param {Ability} ability - Ability object
 * @param {string} action - the ability action
 * @param {string} subject - the ability subject
 * @returns {object} - a feathers query
 *
 * Multiple rules operatoring on the same field will be combined intelligently
 * into a single query.
 *
 * Here are some of the various types of queries that can be created:
 * @example
 *
 *   { field: 'value' }
 *   { field: { '$eq': 'value'} }
 *   { field: { '$ne': 'value'} }
 *   { field: { '$in': ['value1', 'value2'] } }
 *   { field: { '$nin': ['value1', 'value2'] } }
 *   { field: { '$gt': value } }
 *   { field: { '$gte': value } }
 *   { field: { '$lt': value } }
 *   { field: { '$lte': value } }
 *   { field: { '$gte': value, '$lte': value } }
 *
 */
function toFeathersQuery(ability, action, subject) {
  let ast = rulesToAST(ability, action, subject);

  // DOCS: When multiple rules are defined on the subject, CASL will combine
  // them into an `$or` query. We are stripping away the `$or` and selecting
  // the individual rules so that we can combine them in a more efficient manner.
  if (ast.operator === 'or' && _.isArray(ast.value)) {
    ast = ast.value;
  }

  return _.reduce(
    aggregateAST(_.flatten([ast])),
    (acc, rules) => {
      let { field, operator, value } = rules;
      let op = `$${operator}`;
      acc[field] = { ...acc[field], [op]: _.uniq(value) };

      // DOCS: Since we are aggregating the AST and flattening the query,
      // we are extending the boundaries of `gt`, `gte`, `lt`, and `lte`
      // operators to the widest possible range of values, if multiple
      // rules are defined on the same field.
      if (['gt', 'gte'].includes(operator)) {
        acc[field][op] = _.min(value);
      }

      if (['lt', 'lte'].includes(operator)) {
        acc[field][op] = _.max(value);
      }

      return acc;
    },
    {}
  );
}

// namespace of hooks related to authorize
const hooks = {};

module.exports = {
  compileRbacAbility,
  handleBelongsToAccount,
  handleBelongsToStore,
  handleHasAbility,
  hooks,
  OAbility,
  toFeathersQuery,
  toObjectionQuery,
};
