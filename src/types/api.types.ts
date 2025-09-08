// Standardized API response types
export interface ApiErrorResponse {
  error: string;
  code?: string;
  details?: any;
  timestamp: string;
}

export interface ApiSuccessResponse<T = any> {
  data?: T;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
  };
  filters?: any;
}

export interface ValidationErrorResponse extends ApiErrorResponse {
  errors: Array<{
    field: string;
    message: string;
    code: string;
  }>;
}

// HTTP Status codes enum for consistency
export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  INTERNAL_SERVER_ERROR = 500
}
