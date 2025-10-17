import express, { Express, Request, Response } from 'express';
import prisma from './lib/prisma';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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

// Load env (tests can set process.env before importing this file)
dotenv.config();

const app: Express = express();

// Trust proxy for accurate client IP detection (required for rate limiting behind load balancers)
app.set('trust proxy', 1);

app.use(cors());
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
app.use('/api/auth', authRoutes);
app.use('/api', merchantRoutes);
app.use('/api', publicDealRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/master-data', masterDataRoutes);
app.use('/api', cityRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/table-booking', tableBookingRoutes);
app.use('/api/profile', profileRoutes);

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