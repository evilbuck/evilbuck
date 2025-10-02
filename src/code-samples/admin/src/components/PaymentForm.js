import React, { Fragment, useState } from 'react';
import StripeForm from '../components/StripeForm';
import PaypalForm from '../components/PaypalForm.js';
import axios from 'axios';
import _ from 'lodash';
import { Row, Col, Form } from 'react-bootstrap';

const apiUrl = process.env.REACT_APP_API_URL;
const paypalClientId = process.env.REACT_APP_PAYPAL_CLIENT_ID;

async function paypalHandler(amount, details, data) {
  console.log('details: ', details, '\ndata: ', data);
  return axios.post(`${apiUrl}/v1/payments`, {
    billerType: 'paypal',
    intent: 'capture',
    orderToken: details.orderID,
    payerId: details.payerID,
    amount,
    currency: 'usd',
    description: 'hard coded paypal',
    referenceId: 'madeup-id'
  });
}

export default function PaymentForm({
  paymentPayload,
  mergePaymentPayload,
  chargeOrder,
  ...props
}) {
  const [resReq, setResReq] = useState({ currentStep: 1 });
  const [currentStep, setStep] = useState(1);

  let GatewayForm;
  switch (paymentPayload.billerType) {
    case 'paypal-2':
      GatewayForm = (
        <PaypalForm
          mergePaymentPayload={mergePaymentPayload}
          paymentPayload={paymentPayload}
          chargeOrder={chargeOrder}
          {...props}
        />
      );
      break;
    case 'stripe':
      GatewayForm = (
        <StripeForm
          mergePaymentPayload={mergePaymentPayload}
          paymentPayload={paymentPayload}
          chargeOrder={chargeOrder}
          {...props}
        />
      );
      break;
  }

  return (
    <Fragment>
      <Row>
        <Col>
          <Form style={{ textAlign: 'left' }}>
            <Form.Row>
              <Col>
                <Form.Group>
                  <Form.Label>Cardholder Name</Form.Label>

                  <Form.Control
                    placeholder="Card Holder Name"
                    onChange={event => {
                      const customer = {
                        ...paymentPayload.customer,
                        fullName: event.target.value
                      };
                      mergePaymentPayload({ customer });
                    }}
                    value={paymentPayload.customer.fullName}
                  />
                </Form.Group>
              </Col>
            </Form.Row>
            <Form.Row>
              <Col>
                <Form.Group>
                  <Form.Label>Card Number</Form.Label>
                  <Form.Control
                    type="number"
                    placeholder="Card Number"
                    onChange={event => {
                      const card = { ...paymentPayload.card, number: event.target.value };

                      mergePaymentPayload({ card });
                    }}
                    value={paymentPayload.card.number}
                  />
                </Form.Group>
              </Col>

              <Col>
                <Form.Group>
                  <Form.Label>Expiration</Form.Label>
                  <Form.Row>
                    <Col>
                      <Form.Control
                        as="select"
                        value={paymentPayload.card.exp_month}
                        onChange={event => {
                          mergePaymentPayload({
                            card: { ...paymentPayload.card, exp_month: event.target.value }
                          });
                        }}
                      >
                        {_.range(1, 12).map(month => {
                          return (
                            <option value={month} key={month}>
                              {month}
                            </option>
                          );
                        })}
                      </Form.Control>
                    </Col>

                    <Col>
                      <Form.Control
                        as="select"
                        value={paymentPayload.card.exp_year}
                        onChange={event => {
                          paymentPayload.card.exp_year = event.target.value;
                          mergePaymentPayload({ card: paymentPayload.card });
                        }}
                      >
                        {_.range(2020, 2028).map(year =>
                          <option value={year} key={year}>
                            {year}
                          </option>
                        )}
                      </Form.Control>
                    </Col>
                  </Form.Row>
                </Form.Group>
              </Col>
              <Col>
                <Form.Group>
                  <Form.Label>cvc</Form.Label>
                  <Form.Control
                    value={paymentPayload.card.cvc}
                    onChange={event => {
                      paymentPayload.card.cvc = event.target.value;
                      mergePaymentPayload({ card: paymentPayload.card });
                    }}
                  />
                </Form.Group>
              </Col>
            </Form.Row>
          </Form>
        </Col>
        <Col lg={3}>
          <Form.Group>
            <Form.Label>Amount</Form.Label>
            <Form.Control
              value={paymentPayload.charge.amount}
              onChange={event => {
                const amount = event.target.value;
                mergePaymentPayload({
                  charge: { ...paymentPayload.charge, amount },
                  amount
                });
              }}
            />
          </Form.Group>
        </Col>
      </Row>
      <Row>
        <Col>
          {GatewayForm}
        </Col>
      </Row>
    </Fragment>
  );
}
