# Payment Integration (PayPal MVP)

This document explains how to use the new PayPal-based purchase flow from the frontend (e.g., Deal Details page).

## Backend Endpoints

Base path: `/api/payments`

### 1. POST `/intent`

- Purpose: Create a PayPal order on the server for a given amount.
- Body (JSON):
  - `amount`: number (required)
  - `currency`: string, default `USD`
  - `description`: string (optional)
  - `dealId`: number (optional, for reference)
  - `orderId`: number (optional, link to existing `Order`)
 - Response:

```json
{
  "success": true,
  "data": {
    "paymentId": 123,
    "orderId": "PAYPAL_ORDER_ID",
    "approvalUrl": "https://www.paypal.com/checkoutnow?token=...",
    "currency": "USD",
    "amount": 9.99
  }
}
```

### 2. POST `/capture`

- Purpose: Capture a PayPal order after the buyer approves it.
- Body (JSON):
  - `orderId`: string (required) – PayPal order ID received from `/intent`.
 - Response:

```json
{ "success": true, "message": "Payment completed successfully" }
```

## Environment Variables

- `PAYPAL_CLIENT_ID`
- `PAYPAL_SECRET_KEY`
- `PAYPAL_CURRENCY` (optional, default `USD`)
- `FRONTEND_URL` (optional, used for return/cancel URLs)

## Frontend Usage (PayPal Smart Buttons)

Include the PayPal JS SDK in your page (replace with your client-id):

```html
<script src="https://www.paypal.com/sdk/js?client-id=YOUR_CLIENT_ID&components=buttons&currency=USD"></script>
```

Render buttons and wire to backend:

```js
paypal.Buttons({
  createOrder: async () => {
    // Call your backend to create the order
    const resp = await fetch('/api/payments/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount: 9.99, currency: 'USD', description: 'Deal purchase', dealId })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Failed to create order');
    // Return the PayPal order ID from your backend
    return json.data.orderId;
  },
  onApprove: async (data) => {
    // data.orderID is the same orderId
    const resp = await fetch('/api/payments/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId: data.orderID })
    });
    const json = await resp.json();
    if (!json.success) throw new Error(json.message || 'Capture failed');
    // Show success state and refresh deal/profile as needed
  },
  onError: (err) => {
    console.error('PayPal error', err);
  }
}).render('#paypal-buttons');
```

## Notes

- The server currently accepts an `amount` from the client. For production, compute final price server-side based on Deal/Menu/Booking to avoid tampering.
- The database schema now includes generic fields on `PaymentTransaction`: `purpose`, `gateway`, `currency`, `relatedOrderId`.
- Run a Prisma migrate to apply schema changes before first use:


```bash
npx prisma migrate dev --name add_payment_gateway_fields
```

- After capture, integrate loyalty points and `Order` updates where applicable (TODO markers in code).
