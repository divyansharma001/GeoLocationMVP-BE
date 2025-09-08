import { Response } from 'express';
import { ApiErrorResponse, ApiSuccessResponse, ValidationErrorResponse, HttpStatus } from '../types/api.types';

// Standardized response utilities
export class ApiResponse {
  static success<T>(res: Response, data?: T, message?: string, statusCode: number = HttpStatus.OK, meta?: any) {
    const response: ApiSuccessResponse<T> = {
      data,
      message,
      meta
    };
    return res.status(statusCode).json(response);
  }

  static error(res: Response, error: string, statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR, code?: string, details?: any) {
    const response: ApiErrorResponse = {
      error,
      code,
      details,
      timestamp: new Date().toISOString()
    };
    return res.status(statusCode).json(response);
  }

  static validationError(res: Response, errors: Array<{ field: string; message: string; code: string }>) {
    const response: ValidationErrorResponse = {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors,
      timestamp: new Date().toISOString()
    };
    return res.status(HttpStatus.BAD_REQUEST).json(response);
  }

  static notFound(res: Response, resource: string = 'Resource') {
    return this.error(res, `${resource} not found`, HttpStatus.NOT_FOUND, 'NOT_FOUND');
  }

  static unauthorized(res: Response, message: string = 'Authentication required') {
    return this.error(res, message, HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED');
  }

  static forbidden(res: Response, message: string = 'Access denied') {
    return this.error(res, message, HttpStatus.FORBIDDEN, 'FORBIDDEN');
  }

  static conflict(res: Response, message: string) {
    return this.error(res, message, HttpStatus.CONFLICT, 'CONFLICT');
  }

  static badRequest(res: Response, message: string) {
    return this.error(res, message, HttpStatus.BAD_REQUEST, 'BAD_REQUEST');
  }

  static internalError(res: Response, message: string = 'Internal server error') {
    return this.error(res, message, HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR');
  }
}
