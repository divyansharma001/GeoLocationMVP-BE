declare module '@paypal/checkout-server-sdk' {
  export interface PayPalEnvironment {
    authorizationString(): string;
    baseUrl(): string;
  }

  export class core {
    static SandboxEnvironment: new (clientId: string, clientSecret: string) => PayPalEnvironment;
    static LiveEnvironment: new (clientId: string, clientSecret: string) => PayPalEnvironment;
    static PayPalHttpClient: new (environment: PayPalEnvironment) => PayPalHttpClient;
  }

  export class PayPalHttpClient {
    constructor(environment: PayPalEnvironment);
    execute(request: any): Promise<any>;
  }

  export class orders {
    static OrdersCreateRequest: new () => OrdersCreateRequest;
    static OrdersCaptureRequest: new (orderId: string) => OrdersCaptureRequest;
    static OrdersGetRequest: new (orderId: string) => OrdersGetRequest;
  }

  export class OrdersCreateRequest {
    prefer(preference: string): void;
    requestBody(body: any): void;
    headers: { [key: string]: string };
  }

  export class OrdersCaptureRequest {
    constructor(orderId: string);
    requestBody(body: any): void;
    headers: { [key: string]: string };
  }

  export class OrdersGetRequest {
    constructor(orderId: string);
    headers: { [key: string]: string };
  }

  export interface PayPalOrder {
    id: string;
    status: string;
    intent: string;
    purchase_units: Array<{
      amount: {
        currency_code: string;
        value: string;
      };
      description?: string;
    }>;
    links: Array<{
      href: string;
      rel: string;
      method: string;
    }>;
  }

  export interface PayPalCaptureResponse {
    id: string;
    status: string;
    purchase_units: Array<{
      payments: {
        captures: Array<{
          id: string;
          status: string;
          amount: {
            currency_code: string;
            value: string;
          };
        }>;
      };
    }>;
  }
}