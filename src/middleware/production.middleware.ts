import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import compression from 'compression';
import morgan from 'morgan';
import logger from '../lib/logging/logger';
import { metricsCollector } from '../lib/metrics';
import redis, { isRedisReady } from '../lib/redis';

function parseIntEnv(names: string | string[], fallback: number): number {
  const orderedNames = Array.isArray(names) ? names : [names];

  for (const name of orderedNames) {
    const raw = process.env[name];
    if (!raw) {
      continue;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
}

function getForwardedIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    return forwardedFor.split(',')[0]?.trim();
  }

  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0]?.split(',')[0]?.trim();
  }

  return undefined;
}

function getClientKey(req: Request): string {
  const authorization = req.headers.authorization?.trim();
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
      return `token:${tokenHash}`;
    }
  }

  const forwardedIp = getForwardedIp(req);
  const ip = forwardedIp || req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

function shouldSkipRateLimit(req: Request): boolean {
  if (req.method === 'OPTIONS') {
    return true;
  }

  return req.path === '/health' || req.path === '/ready' || req.path === '/live';
}

// Rate limiting globally disabled. Every limiter built via `buildRateLimiter`
// is now a pass-through no-op middleware. To re-enable, restore the original
// implementation from git history (commit before this change).
function buildRateLimiter(_options: {
  name: string;
  windowMs: number;
  limit: number;
  message: string;
}) {
  return (_req: Request, _res: Response, next: NextFunction) => next();
}

// Compression middleware
export const compressionMiddleware = compression({
  level: 6, // Compression level (1-9)
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req: Request, res: Response) => {
    // Don't compress if the request includes a no-transform directive
    if (req.headers['cache-control'] && req.headers['cache-control'].includes('no-transform')) {
      return false;
    }
    return compression.filter(req, res);
  },
});

// HTTP request logging middleware
export const requestLoggingMiddleware = morgan('combined', {
  stream: {
    write: (message: string) => {
      logger.http(message.trim());
    },
  },
  skip: (req: Request) => {
    // Skip logging for health checks to reduce noise
    return req.url === '/health' || req.url === '/ready' || req.url === '/live';
  },
});

// Production-specific rate limiting
// export const productionRateLimit = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   limit: 100, // Reduced limit for production
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: {
//     error: 'Too many requests from this IP, please try again later.',
//   },
//   skip: (req: Request) => {
//     // Skip rate limiting for health checks
//     return req.url === '/health' || req.url === '/ready' || req.url === '/live';
//   },
// });

// Strict rate limiting for auth endpoints
export const apiRateLimit = buildRateLimiter({
  name: 'api',
  windowMs: parseIntEnv(['API_RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_WINDOW_MS'], 15 * 60 * 1000),
  limit: parseIntEnv(['API_RATE_LIMIT_MAX', 'RATE_LIMIT_MAX_REQUESTS'], 1000),
  message: 'Too many API requests, please try again later.',
});

export const authRateLimit = buildRateLimiter({
  name: 'auth',
  windowMs: parseIntEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: parseIntEnv('AUTH_RATE_LIMIT_MAX', 20),
  message: 'Too many authentication attempts, please try again later.',
});

export const expensiveReadRateLimit = buildRateLimiter({
  name: 'expensive-read',
  windowMs: parseIntEnv('EXPENSIVE_READ_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000),
  limit: parseIntEnv('EXPENSIVE_READ_RATE_LIMIT_MAX', 120),
  message: 'Too many expensive read requests, please try again later.',
});

export const detailRateLimit = buildRateLimiter({
  name: 'detail-read',
  windowMs: parseIntEnv('DETAIL_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000),
  limit: parseIntEnv('DETAIL_RATE_LIMIT_MAX', 300),
  message: 'Too many detail requests, please try again later.',
});

export const organizerActionRateLimit = buildRateLimiter({
  name: 'organizer-action',
  windowMs: parseIntEnv('ORGANIZER_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000),
  limit: parseIntEnv('ORGANIZER_RATE_LIMIT_MAX', 40),
  message: 'Too many organizer actions, please try again later.',
});

export const bookingActionRateLimit = buildRateLimiter({
  name: 'booking-action',
  windowMs: parseIntEnv('BOOKING_RATE_LIMIT_WINDOW_MS', 5 * 60 * 1000),
  limit: parseIntEnv('BOOKING_RATE_LIMIT_MAX', 60),
  message: 'Too many booking or QR actions, please try again later.',
});

// Security headers middleware
export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Remove X-Powered-By header
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Add cache control for API responses
  if (req.url.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

// Error handling middleware for production
export const productionErrorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Log the error
  logger.error('Unhandled error:', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  
  // Don't leak error details in production
  if (process.env.NODE_ENV === 'production') {
    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  } else {
    // In development, show full error details
    res.status(500).json({
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  }
};

// Request timeout middleware
export const requestTimeoutMiddleware = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(`Request timeout: ${req.method} ${req.url}`);
        res.status(408).json({
          error: 'Request timeout',
          timestamp: new Date().toISOString(),
        });
      }
    }, timeoutMs);
    
    // Clear timeout when response is sent
    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));
    
    next();
  };
};

// CORS configuration for production
export const productionCorsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
