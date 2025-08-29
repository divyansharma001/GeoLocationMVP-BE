import express, { Express, Request, Response } from 'express';
import prisma from './lib/prisma';
import dotenv from 'dotenv';
import cors from 'cors';

// Import our new auth routes
import authRoutes from './routes/auth.routes';
import merchantRoutes from './routes/merchant.routes'; // For protected merchant actions
import publicDealRoutes from './routes/deals.public.routes'; // For public deal fetching
import userDealRoutes from './routes/deals.user.routes'; // For user-specific deal actions

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.send('YOHOP Server (TypeScript & Prisma Edition) is alive!');
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api', merchantRoutes); // e.g., /api/merchants/register, /api/deals
app.use('/api', publicDealRoutes); // e.g., /api/deals (GET)
app.use('/api/user', userDealRoutes); // e.g., /api/user/deals/save, /api/user/deals/saved

// You can keep this for testing or remove it later
app.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
});