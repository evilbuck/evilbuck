# Overhub Admin - Code Samples

This directory contains code samples from the Overhub admin web application, a React-based interface for managing the payment gateway.

## 🏗️ Architecture Overview

**Framework**: React (Create React App)
**UI Library**: React Bootstrap
**State Management**: React Hooks (useState)
**Backend Integration**: Axios for REST API calls

## 📁 Sample Files

### `src/components/PaymentForm.js`

A sophisticated payment form component demonstrating multi-gateway payment integration.

#### Key Features

**Multi-Gateway Support**
- Dynamically switches between payment gateways (Stripe, PayPal)
- Conditional rendering based on `billerType` prop
- Gateway-specific form components (`StripeForm`, `PaypalForm`)

**Controlled Components Pattern**
- Full form state management with React hooks
- Controlled inputs for all form fields
- Immutable state updates with spread operators

**Form Fields**
- Cardholder name input
- Card number input (type="number")
- Expiration date (month/year selectors)
- CVC input
- Amount input

**State Lifting**
- Uses `mergePaymentPayload` callback prop for state updates
- Demonstrates proper prop drilling and callback patterns
- Maintains single source of truth in parent component

**PayPal Integration**
- Async PayPal order processing
- `paypalHandler` function with orderToken and payerId
- Axios POST to `/v1/payments` endpoint
- Error logging with console.log

#### Technical Demonstrations

**React Patterns**
```javascript
// Controlled components with immutable updates
const handleChange = (event) => {
  const customer = {
    ...paymentPayload.customer,
    fullName: event.target.value
  };
  mergePaymentPayload({ customer });
};
```

**Dynamic Rendering**
```javascript
// Switch statement for gateway selection
let GatewayForm;
switch (paymentPayload.billerType) {
  case 'paypal-2':
    GatewayForm = <PaypalForm {...props} />;
    break;
  case 'stripe':
    GatewayForm = <StripeForm {...props} />;
    break;
}
```

**Lodash Integration**
```javascript
// Dynamic range generation for selectors
_.range(1, 12).map(month => <option value={month} key={month}>{month}</option>)
_.range(2020, 2028).map(year => <option value={year} key={year}>{year}</option>)
```

#### React Bootstrap Components Used
- `Form` - Main form container
- `Form.Row` - Grid layout
- `Form.Group` - Field grouping with labels
- `Form.Label` - Field labels
- `Form.Control` - Input controls (text, number, select)
- `Row` / `Col` - Grid system

#### Environment Configuration
```javascript
const apiUrl = process.env.REACT_APP_API_URL;
const paypalClientId = process.env.REACT_APP_PAYPAL_CLIENT_ID;
```
Demonstrates proper use of environment variables for configuration.

## 🎯 Why This Sample?

1. **Real-World Integration**: Actual payment form used in production
2. **Multi-Gateway Architecture**: Demonstrates abstraction and conditional rendering
3. **React Best Practices**: Controlled components, hooks, immutable updates
4. **Payment Domain Knowledge**: Understanding of payment flows (capture, authorization)
5. **Form Validation**: Structured data collection for payment processing
6. **Component Composition**: Props drilling, callback patterns, reusable components

## 🔗 Related Technologies

- React 16.x+
- React Bootstrap
- Axios
- Lodash
- Environment Variables (dotenv)

## 📝 Notes

This component is part of a larger admin interface that integrates with:
- `StripeForm` - Stripe-specific payment form
- `PaypalForm` - PayPal-specific payment form
- Backend payment processing API (`/v1/payments`)

The form demonstrates practical e-commerce development with multiple payment processor integrations.
