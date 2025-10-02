# Overhub API - Code Samples

This directory contains resume-worthy code samples from the Overhub payment gateway API, a production FeathersJS application managing e-commerce order lifecycle, multi-gateway payments, and complex business rules.

## 🏗️ Architecture Overview

**Framework**: FeathersJS 4.x (Express-based REST API)
**Database**: PostgreSQL with Objection ORM
**Patterns**: Service-oriented architecture, hooks middleware, state machines, rules engine

## 📁 Sample Files

### Core Services

#### `services/orders/`
Complex e-commerce order management with multi-step workflows.

**orders.class.js** (433 lines)
- **Highlights**: Multi-intent order processing (`capture`, `authorize`, `build`)
- **Patterns**: Strategy pattern for order types, adapter pattern for payment gateways
- **Complexity**: Currency conversion, tax calculation, discount strategies, inventory management
- **Key Method**: `async create(data, params)` - orchestrates full order lifecycle with error handling

**orders.hooks.js** (964 lines!)
- **Highlights**: Extensive FeathersJS middleware demonstrating hook architecture
- **Security**: Multi-tenant validation, authentication, authorization with CASL
- **Features**: Session handling, encryption, context population, validation chains
- **Notable**: Shows mastery of FeathersJS hook system and complex middleware composition

**orders.service.js**
- Service registration and configuration
- Demonstrates FeathersJS service setup patterns

#### `services/payments/captures/`
Multi-gateway payment processing with intelligent processor selection.

**captures.class.js**
- **Highlights**: Payment gateway abstraction layer (PayPal, Stripe, NMI)
- **Integration**: Rules engine for processor selection, adapter pattern for gateway APIs
- **Error Handling**: Multiple error types (`PAYMENT_SOURCE_REJECTED`, `PAYMENT_TOKEN_REQUIRED`)
- **Key Features**:
  - Payment source validation and verification
  - Multi-processor failover logic
  - Comprehensive JSDoc documentation

### Business Logic

#### `lib/rule_engine/lib/processor_rules_engine.controller.js`
Sophisticated rules engine for payment processor selection.

- **Technology**: MongoDB aggregation pipeline syntax (via Mingo library)
- **Algorithm**: Weighted random selection with cumulative weights
- **Strategies**:
  - `filterPaymentConfigurations()` - Multi-criteria filtering
  - `weightStrategy()` - Weighted random selection algorithm
  - `aggregationStrategy()` - Complex aggregation pipeline processing
- **Complexity**: Handles processor availability, currency support, amount thresholds, geographic restrictions

#### `lib/models/order.decorator.js`
Decorator and strategy patterns for order calculations.

- **Patterns**:
  - Decorator pattern for order price calculations
  - Strategy pattern for discount types
  - Factory pattern for strategy selection
- **Strategies**:
  - `percentageDiscountStrategy` - Percentage-based discounts
  - `fixedDiscountStrategy` - Fixed amount discounts
  - `noDiscountStrategy` - No discount applied
- **Features**: Tax calculation, subtotals, grand totals with multiple discount types

### State Management

#### `flows/order_refund_flow.js`
XState state machine for complex refund workflows.

- **Technology**: XState 4.x for finite state machines
- **States**: `new` → `select_transaction` → `refund` → `complete/error`
- **Features**:
  - Recursive refund handling across multiple payment transactions
  - Automatic transaction selection (highest balance first)
  - Support for partial refunds and multi-transaction orders
  - Error recovery with state transitions
- **Complexity**: Handles edge cases like insufficient refund balance, multiple captures, order item strategies

#### `lib/flow_actions.js`
Reusable XState action library.

- **Patterns**: Factory functions for XState actions
- **Features**: Error handling, context assignment, logging integration
- **Actions**: `assignId`, `handleError`, `extendContext`, `assignProcessor`, `logContext`

### Infrastructure

#### `lib/angus_queue.js`
Custom Bull Queue extension with job deduplication.

- **Extension**: Extends Bull Queue with hash-based deduplication
- **Pattern**: Custom error type `QueueJobProcessedError` for duplicate detection
- **Algorithm**: Uses `jobId` hash to prevent duplicate job processing
- **Features**: Configurable job options, promise-based API, error handling

#### `lib/authorization.js`
CASL-based authorization with SQL query generation.

- **Technology**: CASL for attribute-based access control
- **Integration**: `@ucast/sql` for AST to SQL conversion
- **Key Function**: `toObjectionQuery()` - Converts CASL rules to Objection.js queries
- **Features**:
  - Debug logging with Winston
  - SQL WHERE clause generation from authorization rules
  - Automatic query scoping based on user permissions

#### `lib/objection_models/base.objection.js`
Base ORM model with plugins and utilities.

- **Plugins**: objection-visibility for field-level access control
- **Features**:
  - Custom AJV validator configuration
  - Full-text search via `sanitizeTsSearchQuery()` for PostgreSQL `to_tsquery`
  - Validation hooks (`$afterFind`)
- **Search Algorithm**: Converts human-readable queries to Postgres full-text search syntax

### Tests

#### `__tests__/services/admin/orders.admin.service.test.js`
Multi-tenant security testing.

- **Focus**: Authorization boundary testing
- **Patterns**: Factory-based test data, multi-account isolation testing
- **Coverage**: Ensures users cannot access orders from other accounts
- **Sophistication**: Tests CASL integration, query scoping, access control edge cases

#### `__tests__/auth/auth.test.js`
Authentication system testing.

- **Coverage**: JWT authentication, API token authentication, user login flows
- **Patterns**: Nested describe blocks for comprehensive test organization
- **Features**: Tests multiple authentication strategies, access control scenarios

#### `__tests__/payments_capture.test.js`
Payment processing tests.

#### `__tests__/rules_engine.test.js`
Rules engine validation tests.

## 🎯 Key Technical Demonstrations

### Design Patterns
- **Service Layer Pattern**: FeathersJS service architecture with hooks
- **Adapter Pattern**: Payment gateway abstraction
- **Strategy Pattern**: Discount calculations, package selection
- **Decorator Pattern**: Order calculation enhancements
- **Factory Pattern**: Strategy selection, action creation
- **Singleton Pattern**: (in related controller code)
- **State Machine Pattern**: XState for complex workflows

### Advanced Concepts
- **Multi-tenancy**: Account-based data isolation with security testing
- **Authorization**: CASL attribute-based access control with AST manipulation
- **State Machines**: XState for complex business workflows
- **Rules Engine**: MongoDB aggregation pipeline for decision logic
- **ORM**: Objection.js with plugins, relations, validation
- **Job Queues**: Bull/Redis with custom deduplication
- **Full-Text Search**: PostgreSQL to_tsquery integration
- **Middleware Architecture**: FeathersJS hooks for request/response processing

### Software Engineering Practices
- **Comprehensive JSDoc**: Detailed API documentation
- **Error Handling**: Custom error types, meaningful error codes
- **Testing**: Unit tests, integration tests, security tests
- **Code Organization**: Service-oriented architecture with clear separation of concerns
- **Logging**: Structured logging with Winston
- **Validation**: AJV schema validation, business rule validation

## 📊 Complexity Metrics

| File | Lines | Complexity | Key Features |
|------|-------|-----------|--------------|
| orders.hooks.js | 964 | Very High | Multi-tenant security, encryption, validation chains |
| orders.class.js | 433 | High | Multi-intent processing, currency conversion |
| captures.class.js | ~350 | High | Multi-gateway integration, rules engine |
| processor_rules_engine.controller.js | ~250 | High | Aggregation pipeline, weighted selection |
| order_refund_flow.js | 177 | Medium-High | State machine, recursive refunds |

## 🚀 Why These Samples?

1. **Production Scale**: Real-world e-commerce platform handling payments, orders, refunds
2. **Architectural Sophistication**: Multiple design patterns, clean separation of concerns
3. **Framework Mastery**: Deep FeathersJS knowledge, hook architecture, service patterns
4. **Security Consciousness**: Multi-tenant isolation, authorization, encryption
5. **Testing Discipline**: Comprehensive test coverage with security focus
6. **Documentation**: Professional JSDoc, clear code comments
7. **Error Handling**: Robust error handling with meaningful error codes
8. **Integration Complexity**: Multiple payment gateways, rules engine, state machines

## 🔗 Related Technologies

- Node.js / JavaScript ES6+
- FeathersJS 4.x
- Objection.js ORM
- Knex query builder
- PostgreSQL
- Bull / Redis
- XState
- CASL
- Mingo
- Jest
