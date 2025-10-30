const paypal = require('@paypal/checkout-server-sdk');

// PayPal SDK Environment setup
function environment() {
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  const clientSecret = process.env.PAYPAL_SECRET_KEY || '';
  
  // Use sandbox environment for development
  return new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

// PayPal client
function client() {
  return new paypal.core.PayPalHttpClient(environment());
}

// Coin packages for purchase
export const COIN_PACKAGES = [
  { coins: 100, price: 0.99, label: 'Starter Pack' },
  { coins: 500, price: 4.99, label: 'Value Pack' },
  { coins: 1000, price: 9.99, label: 'Power Pack' },
  { coins: 2500, price: 19.99, label: 'Premium Pack' },
  { coins: 5000, price: 39.99, label: 'Ultimate Pack' },
];

// Create PayPal order for coin purchase
export async function createPayPalOrder(coinPackage: typeof COIN_PACKAGES[0]) {
  const CURRENCY = process.env.PAYPAL_CURRENCY || 'USD';
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    application_context: {
      brand_name: 'GeoLocation MVP',
      landing_page: 'BILLING',
      user_action: 'PAY_NOW',
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/cancel`,
    },
    purchase_units: [
      {
        reference_id: `coins_${coinPackage.coins}`,
        description: `${coinPackage.label} - ${coinPackage.coins} coins`,
        amount: {
          currency_code: CURRENCY,
          value: coinPackage.price.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: CURRENCY,
              value: coinPackage.price.toFixed(2),
            },
          },
        },
        items: [
          {
            name: coinPackage.label,
            description: `Purchase ${coinPackage.coins} virtual coins`,
            unit_amount: {
              currency_code: CURRENCY,
              value: coinPackage.price.toFixed(2),
            },
            quantity: '1',
            category: 'DIGITAL_GOODS',
          },
        ],
      },
    ],
  });

  try {
    const order = await client().execute(request);
    return {
      success: true,
      orderId: order.result.id,
      approvalUrl: order.result.links?.find((link: any) => link.rel === 'approve')?.href,
      order: order.result,
    };
  } catch (error) {
    console.error('PayPal order creation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Capture PayPal payment
export async function capturePayPalPayment(orderId: string) {
  const request = new paypal.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});

  try {
    const capture = await client().execute(request);
    return {
      success: true,
      captureId: capture.result.id,
      status: capture.result.status,
      capture: capture.result,
    };
  } catch (error: any) {
    console.error('PayPal payment capture failed:', error);
    
    // Handle specific PayPal errors
    if (error.statusCode === 422) {
      const errorDetails = error._originalError?.text ? JSON.parse(error._originalError.text) : {};
      const errorType = errorDetails.details?.[0]?.issue;
      
      if (errorType === 'MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED') {
        return {
          success: false,
          error: 'This payment order has expired. Please create a new payment.',
          errorCode: 'ORDER_EXPIRED',
        };
      } else if (errorType === 'ORDER_ALREADY_CAPTURED') {
        return {
          success: false,
          error: 'This payment has already been processed.',
          errorCode: 'ALREADY_CAPTURED',
        };
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'GENERAL_ERROR',
    };
  }
}

// Get order details
export async function getPayPalOrderDetails(orderId: string) {
  const request = new paypal.orders.OrdersGetRequest(orderId);

  try {
    const order = await client().execute(request);
    return {
      success: true,
      order: order.result,
    };
  } catch (error) {
    console.error('PayPal order details fetch failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default client;