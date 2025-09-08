import express, { Express, Request, Response } from 'express';
import prisma from './lib/prisma';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';

// Import our new auth routes
import authRoutes from './routes/auth.routes';
import merchantRoutes from './routes/merchant.routes'; // For protected merchant actions
import publicDealRoutes from './routes/deals.public.routes'; // For public deal fetching
import userDealRoutes from './routes/deals.user.routes'; // For user-specific deal actions

// Import security middleware
import { authRateLimit, apiRateLimit, sanitizeInput } from './middleware/security.middleware';
import { ApiResponse } from './utils/response.utils';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' })); // Limit request size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput); // Input sanitization
app.use(apiRateLimit); // General rate limiting

app.get('/', (req: Request, res: Response) => {
  res.send('YOHOP Server (TypeScript & Prisma Edition) is alive!');
});

// Mount routes with rate limiting for auth endpoints
app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api', merchantRoutes); // e.g., /api/merchants/register, /api/deals
app.use('/api', publicDealRoutes); // e.g., /api/deals (GET)
app.use('/api/user', userDealRoutes); // e.g., /api/user/deals/save, /api/user/deals/saved

// Global error handler
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Global error handler:', err);
  return ApiResponse.internalError(res, 'An unexpected error occurred');
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  return ApiResponse.notFound(res, 'API endpoint');
});

const server = app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
});