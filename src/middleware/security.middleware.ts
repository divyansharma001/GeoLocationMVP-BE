import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { ApiResponse } from '../utils/response.utils';

// Rate limiting for authentication endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiting
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Input sanitization middleware
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
  // Sanitize string inputs to prevent XSS
  const sanitizeString = (str: any): string => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .trim()
      .substring(0, 1000); // Limit length
  };

  // Sanitize body parameters
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }

  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeString(req.query[key] as string);
      }
    });
  }

  next();
};

// Validation middleware
export const handleValidationErrors = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const validationErrors = errors.array().map((error: any) => ({
      field: error.type === 'field' ? error.path : 'unknown',
      message: error.msg,
      code: 'VALIDATION_ERROR'
    }));
    return ApiResponse.validationError(res, validationErrors);
  }
  next();
};

// Common validation rules
export const commonValidations = {
  email: body('email')
    .isEmail()
    .withMessage('Invalid email address')
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage('Email must be less than 255 characters'),

  password: body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),

  name: body('name')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),

  businessName: body('businessName')
    .isLength({ min: 1, max: 200 })
    .withMessage('Business name must be between 1 and 200 characters')
    .matches(/^[a-zA-Z0-9\s\-&.,'()]+$/)
    .withMessage('Business name contains invalid characters'),

  address: body('address')
    .isLength({ min: 1, max: 500 })
    .withMessage('Address must be between 1 and 500 characters'),

  latitude: body('latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90 degrees'),

  longitude: body('longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180 degrees'),

  dealTitle: body('title')
    .isLength({ min: 1, max: 200 })
    .withMessage('Deal title must be between 1 and 200 characters'),

  dealDescription: body('description')
    .isLength({ min: 1, max: 1000 })
    .withMessage('Deal description must be between 1 and 1000 characters'),

  category: body('category')
    .optional()
    .isIn([
      'FOOD_AND_BEVERAGE', 'RETAIL', 'ENTERTAINMENT', 'HEALTH_AND_FITNESS',
      'BEAUTY_AND_SPA', 'AUTOMOTIVE', 'TRAVEL', 'EDUCATION', 'TECHNOLOGY',
      'HOME_AND_GARDEN', 'OTHER'
    ])
    .withMessage('Invalid category'),

  searchTerm: body('search')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search term must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-&.,'()]+$/)
    .withMessage('Search term contains invalid characters')
};
