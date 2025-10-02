# Overhub Code Samples - Portfolio

Production-quality code samples from the Overhub e-commerce platform, a comprehensive payment gateway and order management system.

## 📋 Overview

This repository contains carefully selected code samples demonstrating:
- **Backend Development**: FeathersJS API with complex business logic
- **Frontend Development**: React and Vue 3 applications
- **Architecture**: Multiple design patterns and sophisticated system design
- **E-commerce Domain**: Payment processing, order management, shopping cart

## 🏗️ Project Structure

```
code-samples/
├── overhub-api/          # FeathersJS payment gateway API
├── admin/                # React admin interface
├── portable-cart/        # Vue 3 embeddable shopping cart
└── README.md            # This file
```

## 🎯 Sample Directories

### 📦 [overhub-api/](./overhub-api/)

**Technology**: Node.js, FeathersJS, PostgreSQL, Objection ORM

**Highlights**:
- Complex order lifecycle management (433 lines)
- Extensive middleware architecture (964 lines of hooks!)
- Multi-gateway payment processing
- Rules engine with aggregation pipeline
- XState state machines for refund workflows
- CASL authorization with SQL query generation
- Custom Bull Queue with job deduplication
- Multi-tenant security testing

**Key Files**: 13 implementation files + 4 test files

**Design Patterns**: Service layer, Adapter, Strategy, Decorator, Factory, State machine

### 🖥️ [admin/](./admin/)

**Technology**: React, React Bootstrap, Axios

**Highlights**:
- Multi-gateway payment form
- Controlled components pattern
- Dynamic gateway switching
- State lifting and prop drilling
- Integration with payment processors

**Key Files**: 1 React component (PaymentForm.js)

**Patterns**: Controlled components, Conditional rendering, Callback props

### 🛒 [portable-cart/](./portable-cart/)

**Technology**: Vue 3, Pinia, Axios, Parcel

**Highlights**:
- Complex state management (400+ lines)
- Dynamic filtering system with operators
- Memoization for performance
- Singleton API controller
- Event-driven architecture
- LocalStorage persistence

**Key Files**: 2 files (Pinia store + controller)

**Patterns**: Singleton, Strategy, Observer, Memoization

## 🔑 Key Technical Competencies

### Backend Engineering
- **Frameworks**: FeathersJS (Express-based), Node.js
- **Databases**: PostgreSQL with Objection ORM
- **Job Queues**: Bull with Redis
- **State Management**: XState finite state machines
- **Authorization**: CASL attribute-based access control
- **Testing**: Jest with comprehensive test coverage

### Frontend Engineering
- **React**: Hooks, controlled components, state management
- **Vue 3**: Composition API, Pinia stores
- **UI Frameworks**: React Bootstrap
- **HTTP Clients**: Axios with interceptors
- **Build Tools**: Parcel

### Architecture & Design
- **Design Patterns**:
  - Service Layer Pattern
  - Adapter Pattern (payment gateways)
  - Strategy Pattern (discounts, package selection)
  - Decorator Pattern (order calculations)
  - Factory Pattern (strategy selection)
  - Singleton Pattern (API controller)
  - Observer Pattern (event publishing)
  - State Machine Pattern (XState)
- **Multi-tenancy**: Account-based isolation with security
- **Rules Engine**: MongoDB aggregation pipeline (Mingo)
- **API Design**: RESTful endpoints with proper HTTP methods

### Domain Expertise
- **E-commerce**: Order lifecycle, cart management, checkout flows
- **Payment Processing**: Multi-gateway integration (PayPal, Stripe, NMI)
- **Financial Operations**: Refunds, captures, authorizations, currency conversion
- **Security**: Multi-tenant isolation, encryption, token management

### Software Engineering Practices
- **Documentation**: Comprehensive JSDoc with type definitions
- **Testing**: Unit, integration, and security tests
- **Error Handling**: Custom error types, meaningful error codes
- **Logging**: Structured logging with Winston
- **Code Organization**: Clear separation of concerns
- **Version Control**: Git with conventional commits

## 📊 Sample Statistics

| Project | Files | Total Lines | Complexity | Tests |
|---------|-------|-------------|-----------|--------|
| overhub-api | 13 | ~3,500+ | Very High | 4 test files |
| admin | 1 | ~180 | Medium | - |
| portable-cart | 2 | ~900+ | High | - |
| **Total** | **16** | **~4,580+** | - | **4+** |

## 🌟 Notable Achievements

### Complexity Highlights
- **orders.hooks.js**: 964 lines of sophisticated middleware demonstrating mastery of FeathersJS
- **overhub_store.js**: 400+ lines of complex state management with dynamic filtering
- **captures.class.js**: Multi-gateway payment abstraction with rules engine integration
- **processor_rules_engine.controller.js**: Advanced aggregation pipeline for intelligent processor selection

### Technical Depth
- **XState Integration**: Complex refund workflows with recursive transaction handling
- **CASL Authorization**: AST to SQL query conversion for dynamic access control
- **Memoization**: Performance optimization with lodash.memoize
- **Job Deduplication**: Custom Bull Queue extension preventing duplicate processing
- **Full-Text Search**: PostgreSQL to_tsquery integration with query sanitization

### Real-World Production Code
All samples are from a production e-commerce platform:
- Multi-tenant SaaS architecture
- Payment processing for real transactions
- Production-grade error handling
- Security-conscious design
- Comprehensive testing

## 🚀 Use Cases Demonstrated

### Backend
- Complex business logic orchestration
- Multi-step workflows with state machines
- Payment gateway abstraction and integration
- Rules-based decision making
- Job queue management
- Multi-tenant security
- Authorization and access control
- Full-text search implementation

### Frontend
- Complex state management (Pinia)
- Multi-gateway payment forms
- Dynamic filtering systems
- Event-driven architecture
- Session persistence
- API integration patterns

## 📖 Documentation

Each directory contains its own detailed README:
- **[overhub-api/README.md](./overhub-api/README.md)**: Detailed backend architecture and patterns
- **[admin/README.md](./admin/README.md)**: React component documentation
- **[portable-cart/README.md](./portable-cart/README.md)**: Vue 3 state management and API integration

## 💡 Why These Samples?

1. **Production Quality**: Real-world code from a live e-commerce platform
2. **Architectural Sophistication**: Multiple design patterns and clean architecture
3. **Framework Mastery**: Deep knowledge of FeathersJS, React, Vue 3
4. **Domain Complexity**: E-commerce and payment processing expertise
5. **Testing Discipline**: Comprehensive test coverage with security focus
6. **Documentation**: Professional JSDoc and code comments
7. **Security**: Multi-tenant isolation, encryption, token management
8. **Performance**: Memoization, job queues, efficient database queries
9. **Integration Skills**: Multiple APIs, payment gateways, state machines
10. **Software Engineering Excellence**: Clean code, SOLID principles, best practices

## 🔗 Technologies Demonstrated

**Backend**: Node.js, FeathersJS, Express, PostgreSQL, Objection.js, Knex, Bull, Redis, XState, CASL, Mingo, Jest

**Frontend**: React, Vue 3, Pinia, React Bootstrap, Axios, Parcel, Lodash

**Patterns**: Service Layer, Adapter, Strategy, Decorator, Factory, Singleton, Observer, State Machine

**Concepts**: Multi-tenancy, Authorization, Job Queues, State Machines, Rules Engine, Full-Text Search, Event-Driven Architecture

---

*These samples represent a curated selection from a larger monorepo containing 244+ service files and a comprehensive e-commerce platform.*
