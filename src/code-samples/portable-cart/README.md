# Overhub Portable Cart - Code Samples

This directory contains code samples from the Overhub embeddable shopping cart widget, a standalone Vue 3 application with Pinia state management.

## 🏗️ Architecture Overview

**Framework**: Vue 3 with Composition API
**State Management**: Pinia
**Build Tool**: Parcel
**HTTP Client**: Axios
**Key Patterns**: Singleton, Strategy, Observer

## 📁 Sample Files

### `src/stores/overhub_store.js` (400+ lines)

A sophisticated Pinia store demonstrating advanced state management patterns.

#### Key Features

**Complex State Structure**
```javascript
state: {
  catalog: null,           // Product catalog data
  package_collections: [], // Package collection hierarchy
  filters: [],            // Dynamic filter definitions
  cart: {},               // Shopping cart state
  cart_token: null,       // Cart session token
  paymentToken: null,     // Payment authorization token
  public_token: null,     // Public order access token
  // ... and more
}
```

**Dynamic Filtering System**
- Operator-based filter engine supporting multiple comparison types
- Supported operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `nin`, `contains`, `exists`
- Multi-criteria filtering with AND logic
- JSON path traversal for nested property filtering

**Advanced Getters with Memoization**
```javascript
getPackageCollectionItem() {
  return memoize((id) => {
    // Complex nested finding logic with memoization for performance
    return this.package_collections.find(/* ... */) ||
           nestedFind(this.package_collections, id);
  });
}
```

**Strategy Pattern for Package Selection**
```javascript
getSelectedPackage(state) {
  // Determines package selection based on availability and rules
  // Falls back through multiple strategies
}
```

**Security Features**
- HTML entity decoding via DOMParser (prevents XSS)
- Token-based authentication
- Safe property access patterns

#### Technical Demonstrations

**JSDoc Type Definitions**
```javascript
/**
 * @typedef {Object} Filter
 * @property {string} key - The property path to filter on (supports nested paths)
 * @property {string} operator - The comparison operator (eq, ne, lt, lte, gt, gte, in, nin, contains, exists)
 * @property {any} value - The value to compare against
 * @property {string} [label] - Human-readable label for the filter
 */
```

**Memoization Pattern**
```javascript
import memoize from 'lodash.memoize';

getPackageCollectionItem() {
  return memoize((id) => {
    // Expensive computation cached by ID
  });
}
```

**Operator-Based Filtering**
```javascript
const operators = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  in: (a, b) => b.includes(a),
  nin: (a, b) => !b.includes(a),
  contains: (a, b) => a && a.includes(b),
  exists: (a, b) => b ? a !== null && a !== undefined : a === null || a === undefined
};
```

**Nested Property Access**
```javascript
function getNestedProperty(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
```

#### Actions (State Mutations)

**Catalog Management**
- `setCatalog()` - Set product catalog
- `setPackageCollections()` - Set package collection hierarchy
- `setFilters()` - Configure dynamic filters

**Cart Operations**
- `setCart()` - Update cart state
- `setCartToken()` - Set cart session token
- `addPackageToCart()` - Add item to cart

**Payment Flow**
- `setPaymentToken()` - Set payment authorization token
- `setBillingContact()` / `setShippingContact()` - Set contact information

**Filter Management**
- `setFilteredPackages()` - Apply filters to package list
- `clearFilteredPackages()` - Reset filters

### `src/controllers/overhub.controller.js`

A singleton API client controller demonstrating REST integration patterns.

#### Key Features

**Singleton Pattern**
```javascript
class OverhubController {
  static instance = null;

  static getInstance(options) {
    if (!OverhubController.instance) {
      OverhubController.instance = new OverhubController(options);
    }
    return OverhubController.instance;
  }
}
```

**Axios Configuration**
```javascript
init(options) {
  const accessToken = options.api_key;

  this.client = axios.create({
    baseURL: process.env.API_URL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    withCredentials: false,
  });
}
```

**Event Publisher Integration**
```javascript
// Publishes events for external listeners
EventPublisher.publish('cart:created', cart);
EventPublisher.publish('order:created', order);
EventPublisher.publish('order:payment:completed', order);
```

**LocalStorage Persistence**
```javascript
// Uses ClientPersist for state persistence
this.clientPersist.setItem('cart_token', cart_token);
this.clientPersist.setItem('public_token', public_token);
```

#### API Methods

**Catalog Operations**
- `getCatalog()` - Fetch product catalog
- `getPackageCollections()` - Fetch package hierarchy

**Cart Management**
- `createCart()` - Initialize new shopping cart
- `updateCart()` - Update cart contents
- `addPackagesToCart()` - Add items to cart
- `removePackageFromCart()` - Remove items from cart

**Order Processing**
- `createOrder()` - Create new order
- `confirmOrder()` - Confirm order details
- `chargeOrder()` - Process payment

**Payment Token Management**
- `createPaymentToken()` - Create payment authorization token
- Associates payment method with cart for checkout

**Session Recovery**
- `recoverCart()` - Restore cart from local storage
- `recoverOrder()` - Restore order from public token

## 🎯 Key Technical Demonstrations

### Design Patterns
- **Singleton Pattern**: Single instance of API controller
- **Strategy Pattern**: Package selection with fallback strategies
- **Observer Pattern**: Event publisher for external integration
- **Memoization Pattern**: Performance optimization with lodash.memoize

### Advanced Concepts
- **Dynamic Filtering**: Operator-based filter engine with JSON path support
- **State Management**: Complex Pinia store with nested state
- **Token-Based Auth**: Cart tokens, payment tokens, public tokens
- **Session Persistence**: LocalStorage integration for state recovery
- **Event-Driven Architecture**: EventPublisher for decoupling
- **Security**: HTML entity decoding, safe property access

### Software Engineering Practices
- **Comprehensive JSDoc**: TypeScript-style type definitions in comments
- **Code Organization**: Clear separation of concerns (store vs controller)
- **Error Handling**: Debug logging, graceful degradation
- **Performance**: Memoization for expensive computations
- **Configuration**: Environment variables for API endpoints

## 📊 Complexity Metrics

| File | Lines | Complexity | Key Features |
|------|-------|-----------|--------------|
| overhub_store.js | 400+ | Very High | Dynamic filters, memoization, complex getters |
| overhub.controller.js | 500+ | High | Singleton, API integration, event publishing |

## 🚀 Why These Samples?

1. **Vue 3 Mastery**: Modern Vue 3 with Composition API and Pinia
2. **State Management**: Complex state structure with advanced patterns
3. **Performance Optimization**: Memoization, efficient filtering
4. **API Integration**: RESTful client with proper authentication
5. **Design Patterns**: Multiple patterns (Singleton, Strategy, Observer)
6. **E-commerce Domain**: Real-world shopping cart implementation
7. **Documentation**: Professional JSDoc with type definitions
8. **Security Consciousness**: XSS prevention, token management
9. **Event-Driven Design**: Publisher pattern for extensibility
10. **Persistence**: LocalStorage integration for session recovery

## 🔗 Related Technologies

- Vue 3
- Pinia
- Axios
- Lodash (memoize)
- Parcel
- JavaScript ES6+
- Event-Driven Architecture
- RESTful APIs

## 📝 Integration Notes

This embeddable cart widget is designed to:
- Be embedded in any website via script tag
- Maintain independent state and session
- Integrate with parent page via events
- Support multi-step checkout flow
- Handle payment processing with multiple gateways
- Persist state across page refreshes
