import express, { Express, Request, Response } from 'express';
import prisma from './lib/prisma';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authRateLimit } from './middleware/production.middleware';

// Routes
import authRoutes from './routes/auth.routes';
import merchantRoutes from './routes/merchant.routes';
import publicDealRoutes from './routes/deals.public.routes';
import userRoutes from './routes/user.routes';
import leaderboardRoutes from './routes/leaderboard.routes';
import adminRoutes from './routes/admin.routes';
import cityRoutes from './routes/cities.routes';
import masterDataRoutes from './routes/master-data.routes';
import mediaRoutes from './routes/media.routes';
import tableBookingRoutes from './routes/table-booking.routes';
import profileRoutes from './routes/profile.routes';
import gamificationRoutes from './routes/gamification.routes';
import streakRoutes from './routes/streak.routes';
import loyaltyRoutes from './routes/loyalty.routes';
import loyaltyMerchantRoutes from './routes/loyalty.merchant.routes';
import heistRoutes from './routes/heist.routes';
import paymentsRoutes from './routes/payments.routes';
import socialAuthRoutes from './routes/social.routes';
import eventsRoutes from './routes/events.routes';
import nudgesRoutes from './routes/nudges.routes';
import adminNudgesRoutes from './routes/admin-nudges.routes';
import kittyRoutes from './routes/kitty.routes';
import adminGamesRoutes from './routes/admin-games.routes';
import venueRewardRoutes from './routes/venue-reward.routes';

// Load env (tests can set process.env before importing this file)
dotenv.config();

const app: Express = express();

// Trust proxy for accurate client IP detection (required for rate limiting behind load balancers)
app.set('trust proxy', 1);

// CORS configuration with whitelist support
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // In development/test, allow all origins
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return callback(null, true);
    }

    // In production, check against whitelist
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : [];

    // If no whitelist configured, allow all (with warning)
    if (allowedOrigins.length === 0) {
      console.warn('[CORS] No ALLOWED_ORIGINS configured. Allowing all origins.');
      return callback(null, true);
    }

    // Check if origin is in whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Check for wildcard subdomain matching (e.g., "*.example.com")
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2);
        return origin.endsWith(domain) || origin.endsWith('.' + domain);
      }
      return false;
    });

    if (isAllowed) {
      return callback(null, true);
    }

    // Origin not allowed
    console.warn(`[CORS] Blocked request from origin: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  maxAge: 86400, // Cache preflight for 24 hours
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(helmet());

// Basic rate limiting (disabled in test for speed)
if (process.env.NODE_ENV !== 'test') {
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);
}

app.get('/', (req: Request, res: Response) => {
  res.send('YOHOP Server (TypeScript & Prisma Edition) is alive!');
});

// Mount routes
// Apply strict rate limiting to auth endpoints (5 req/15min) to prevent brute force attacks
if (process.env.NODE_ENV !== 'test') {
  app.use('/api/auth/login', authRateLimit);
  app.use('/api/auth/register', authRateLimit);
}
app.use('/api/auth', authRoutes);
app.use('/api/auth', socialAuthRoutes);
app.use('/api', merchantRoutes);
app.use('/api', publicDealRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/master-data', masterDataRoutes);
app.use('/api/admin/nudges', adminNudgesRoutes);
app.use('/api', cityRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/table-booking', tableBookingRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/gamification', gamificationRoutes);
app.use('/api/streak', streakRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/merchants', loyaltyMerchantRoutes);
app.use('/api/heist', heistRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/nudges', nudgesRoutes);
app.use('/api/kitty', kittyRoutes);
app.use('/api/admin/games', adminGamesRoutes);
app.use('/api/venue-rewards', venueRewardRoutes);

export default app;

// Utility to help tests clean DB safely
export async function resetDatabase() {
  // Ensure we are not pointing at production DB
  const url = process.env.DATABASE_URL || '';
  if (!url || /prod|production/i.test(url)) {
    throw new Error('Refusing to reset database: DATABASE_URL appears to be production.');
  }
  // Truncate in dependency-safe order using CASCADE
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "UserPointEvent","CheckIn","UserDeal","Deal","Merchant","User" RESTART IDENTITY CASCADE;');
}