const { Model, AjvValidator, mixin } = require('objection');
const visibilityPlugin = require('objection-visibility').default;
const tsquery = require('pg-tsquery')();

// NOTE: The objection-visibility plugin allows us to either show or hide certain columns
// when the data is serialized to JSON. This way Feathers services won't leak
// sensitive information to the outside.
// https://www.npmjs.com/package/objection-visibility

const ModelPlugins = mixin(Model, [visibilityPlugin]);

module.exports = class BaseObjectionModel extends ModelPlugins {
  static createValidator() {
    return new AjvValidator({
      onCreateAjv: (ajv) => {
        // TODO: find out why this breaks. possibly the ajv version is too old
        // addFormats(ajv);
      },
      options: {
        allErrors: true,
        validateSchema: true,
        ownProperties: true,
        v5: true,
        coerceTypes: true,
      },
    });
  }

  $afterFind(queryContext) {
    this.$validate();
  }

  /**
   * Sanitize a search query string for use with the Postgres to_tsquery function.
   * Uses the pg-tsquery library to convert humanized search queries to a Postgres
   * formatted query operators.
   * Search queries are expected to be in the format of:
   * - `foo bar` => `foo & bar`
   * - `foo -bar`, `foo !bar` => `foo + !bar`
   * - `foo bar,bip`, `foo+bar \| bip` => `foo & bar | bip`
   * - `foo (bar,bip)`, `foo+(bar\|bip)` => `foo & (bar | bip)`
   * - `foo>bar>bip` => `foo <-> bar <-> bip` : foo then bar then bip
   * - `foo*,bar* bana:*` => `foo* & bar* & bana:*`
   * - `"foo bar"` => `foo <-> bar`
   *
   * @param {string} query The search query
   * @param {boolean} [isWildcard] Whether to treat the last search term as a wildcard
   * @returns {string} The sanitized query
   */
  static sanitizeTsSearchQuery(query, isWildcard = false) {
    let sanitizedQuery = String(query).trim();
    return tsquery(sanitizedQuery + (isWildcard ? '*' : ''));
  }
};
