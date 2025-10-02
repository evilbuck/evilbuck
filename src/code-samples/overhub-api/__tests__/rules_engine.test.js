const { Rule, RuleGroup } = require('../lib/rule_engine');
const { Aggregator } = require('mingo/aggregator');
const { useOperators, OperatorType } = require('mingo/core');
const { $match, $group } = require('mingo/operators/pipeline');
const { $min } = require('mingo/operators/accumulator');
useOperators(OperatorType.PIPELINE, { $match, $group });
useOperators(OperatorType.ACCUMULATOR, { $min });

describe('Overhub', () => {
  describe('Rules Engine', () => {
    describe('Rule', () => {
      describe('validation', () => {
        it('requires a rule', () => {
          expect(() => {
            new Rule({});
          }).toThrow(/"rule" is required/);
        });

        it('the rule must be a valid mingo query', () => {
          expect(() => {
            new Rule({ rule: { $wtf: 'lol' } });
          }).toThrowError(/rule.invalid:/);
        });
      });

      it('simple test', () => {
        let rule = new Rule({ rule: { type: 'mtd', amount: { $gt: 100 } } });
        let data = [{ processor_id: 2, type: 'mtd', amount: 101, payment_transaction_count: 10 }];
        expect(rule.test(data)).toEqual(true);
      });

      it('fails', () => {
        let data = [{ processor_id: 2, type: 'mtd', amount: 101, payment_transaction_count: 10 }];
        let rule = new Rule({
          rule: { type: 'mtd', amount: { $gt: 101 } },
        });
        expect(rule.test(data)).toBe(false);
      });
    });

    describe('RuleGroup', () => {
      describe('validation', () => {
        it('requires rules', () => {
          expect(() => {
            new RuleGroup({ combinator: 'and' });
          }).toThrowError(/"rules" is required/);
        });

        it('rules must be a Rule or RuleGroup', () => {
          expect(() => {
            new RuleGroup({
              combinator: 'and',
              rules: [{ type: 'mtd', amount: { $gt: 100 } }],
            });
          }).toThrowError(/"rules\[0\]" does not match any of the allowed types/);
        });

        it('requires a combinator', () => {
          expect(() => {
            new RuleGroup({ rules: [{}] });
          }).toThrowError(/"combinator" is required/);
        });

        it('the combinator must be of "and" or "or"', () => {
          expect(() => {
            new RuleGroup({ combinator: 'foo', rules: [{}] });
          }).toThrowError(/"combinator" must be one of/);
        });
      });

      describe('AND', () => {
        let data;
        beforeEach(() => {
          data = [{ processor_id: 2, type: 'mtd', amount: 101, payment_transaction_count: 9 }];
        });

        describe('all rules must pass', () => {
          it('when rules are instantiated', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'and',
              rules: [
                new Rule({ rule: { type: 'mtd', amount: { $gt: 100 } } }),
                new Rule({ rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } }),
              ],
            });

            expect(ruleGroup.test(data)).toEqual(true);
          });

          it('when rules are a pojo', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'and',
              rules: [
                { type: 'rule', rule: { type: 'mtd', amount: { $gt: 100 } } },
                { type: 'rule', rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } },
              ],
            });

            expect(ruleGroup.test(data)).toEqual(true);
          });
        });

        it('when a single rule fails', () => {
          let ruleGroup = new RuleGroup({
            combinator: 'and',
            rules: [
              // failing rule
              new Rule({ rule: { type: 'mtd', amount: { $gt: 101 } } }),
              new Rule({ rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } }),
            ],
          });
          expect(ruleGroup.test(data)).toEqual(false);
        });

        describe('with groups of rules within the group', () => {
          it('with a failing, nested rule', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'and',
              rules: [
                new RuleGroup({
                  combinator: 'and',
                  rules: [
                    // failing rule
                    new Rule({ rule: { type: 'mtd', amount: { $gt: 101 } } }),
                  ],
                }),
                new Rule({ rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } }),
              ],
            });
            expect(ruleGroup.test(data)).toEqual(false);
          });

          describe('with pojo definition and nested rule groups', () => {
            it('with a failing, nested rule', () => {
              let ruleGroup = new RuleGroup({
                combinator: 'and',
                rules: [
                  {
                    type: 'rule_group',
                    combinator: 'and',
                    rules: [
                      // failing rule
                      { type: 'rule', rule: { type: 'mtd', amount: { $gt: 101 } } },
                    ],
                  },
                  { type: 'rule', rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } },
                ],
              });
              expect(ruleGroup.test(data)).toEqual(false);
            });
          });

          it('when all rules in the sub group pass', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'and',
              rules: [
                new RuleGroup({
                  combinator: 'and',
                  rules: [new Rule({ rule: { type: 'mtd', amount: { $gt: 99 } } })],
                }),
                new Rule({ rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } }),
              ],
            });
            expect(ruleGroup.test(data)).toEqual(true);
          });
        });
      });

      describe('OR', () => {
        let data;
        beforeEach(() => {
          data = [{ processor_id: 2, type: 'mtd', amount: 101, payment_transaction_count: 9 }];
        });

        it('when a single rule passes', () => {
          let ruleGroup = new RuleGroup({
            combinator: 'or',
            rules: [
              // passing rule
              new Rule({ rule: { type: 'mtd', amount: { $gt: 99 } } }),
              //failing rule
              new Rule({ rule: { type: 'mtd', amount: { $gt: 101 } } }),
            ],
          });
          expect(ruleGroup.test(data)).toEqual(true);
        });

        it('when all the rules fail', () => {
          let ruleGroup = new RuleGroup({
            combinator: 'or',
            rules: [
              //failing rules
              new Rule({ rule: { type: 'mtd', payment_transaction_count: { $gt: 10 } } }),
              new Rule({ rule: { type: 'mtd', amount: { $gt: 101 } } }),
            ],
          });
          expect(ruleGroup.test(data)).toEqual(false);
        });

        describe('with groups of rules within the group', () => {
          it('fails when a sub-group fails', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'or',
              rules: [
                new Rule({ rule: { type: 'mtd', payment_transaction_count: { $gt: 9 } } }),
                // failing rule group
                new RuleGroup({
                  combinator: 'and',
                  rules: [
                    //failing rules
                    new Rule({ rule: { type: 'mtd', amount: { $gt: 101 } } }),
                    // passing rule
                    new Rule({ rule: { type: 'mtd', amount: { $gt: 99 } } }),
                  ],
                }),
              ],
            });

            expect(ruleGroup.test(data)).toEqual(false);
          });

          it('when the subgroup succeeds', () => {
            let ruleGroup = new RuleGroup({
              combinator: 'or',
              rules: [
                // failing rule
                new Rule({ rule: { type: 'mtd', payment_transaction_count: { $gt: 9 } } }),

                // passing rule group
                new RuleGroup({
                  combinator: 'and',
                  rules: [
                    // passing rules
                    new Rule({ rule: { type: 'mtd', payment_transaction_count: { $lt: 10 } } }),
                    new Rule({ rule: { type: 'mtd', amount: { $gt: 99 } } }),
                  ],
                }),
              ],
            });

            expect(ruleGroup.test(data)).toEqual(true);
          });
        });
      });
    });

    describe('Rule Aggregator', () => {
      describe('Round robin', () => {
        let data, oldestUsedPaymentConfiguration;
        beforeEach(() => {
          (oldestUsedPaymentConfiguration = {
            processor_id: 2,
            type: 'mtd',
            amount: 102,
            payment_transaction_count: 9,
            last_payment_transaction_date: new Date(2022, 3, 1),
          }),
            (data = [
              oldestUsedPaymentConfiguration,
              {
                processor_id: 3,
                type: 'mtd',
                amount: 101,
                payment_transaction_count: 10,
                last_payment_transaction_date: new Date(2022, 3, 2),
              },
            ]);
        });

        it('should return the last used rule', () => {
          const agg = new Aggregator([{ $sort: { last_payment_transaction_date: 1 } }, { $limit: 1 }]);

          let [result] = agg.run(data);
          expect(result).toEqual(oldestUsedPaymentConfiguration);
        });
      });
    });
  });
});
