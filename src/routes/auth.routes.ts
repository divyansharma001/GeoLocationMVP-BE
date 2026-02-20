import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { getPointConfig } from '../lib/points';
import { sendWelcomeEmail, sendReferralSuccessEmail } from '../lib/email';
import { invalidateLeaderboardCache } from '../lib/leaderboard/cache';
import { awardToken, createTokenEarnedNotification } from '../lib/heist';

const router = Router();


// --- Endpoint: POST /api/auth/register ---
const registerSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters long" }),
  name: z.string().optional(),
  referralCode: z.string().length(8).optional() // code used during signup
});

router.post('/register', async (req: Request, res: Response) => {
  try {
  const { email, password, name, referralCode } = registerSchema.parse(req.body);
        
        // Normalize email to lowercase to prevent case sensitivity issues
        const normalizedEmail = email.toLowerCase().trim();

    // 2. Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(409).json({ error: 'Email is already in use' });
    }

    // 3. Hash the password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

    // 4. Create the new user in the database
    const { signupPoints } = getPointConfig();

    function generateReferralCode(): string {
      // 8-char base36 (excluding easily confusable chars) random code
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 8; i++) {
        code = code + alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      return code;
    }

  async function getUniqueReferralCode(tx: any): Promise<string> {
      // Retry a few times in the unlikely event of collision
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateReferralCode();
    // @ts-ignore referralCode pending prisma generate
    const existing = await tx.user.findFirst({ where: { referralCode: code }, select: { id: true } });
        if (!existing) return code;
      }
      throw new Error('Failed to generate unique referral code after 5 attempts');
    }

  // Using any because generated Prisma types may be stale during migration application
  // and we only need a few selected fields for the email notification.
  let referrerForEmail: any = null;
  const newUser = await prisma.$transaction(async (tx) => {
      const referralCode = await getUniqueReferralCode(tx);
      // If user supplied a referral code, fetch referrer
      let referredByUserId: number | undefined = undefined;
      if (req.body.referralCode) {
    referrerForEmail = await tx.user.findFirst({ where: { referralCode: req.body.referralCode }, select: { id: true, email: true, name: true, referralCode: true } });
    if (referrerForEmail) referredByUserId = referrerForEmail.id;
      }
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          name,
          password: hashedPassword,
          points: signupPoints,
          // @ts-ignore new field added in migration; prisma generate pending
          monthlyPoints: signupPoints,
          // @ts-ignore new field added in migration; prisma generate pending
          referralCode,
          // @ts-ignore new field added in migration; prisma generate pending
          referredByUserId
        } as any,
      });
      await tx.userPointEvent.create({
        data: {
          userId: created.id,
          pointEventTypeId: 1, // SIGNUP point event type
          points: signupPoints
        }
      });
  // Invalidate monthly & day caches (signup only affects current period aggregates)
  invalidateLeaderboardCache('month');
  invalidateLeaderboardCache('day');
      return created;
    });

    // We don't want to send the password back, even the hashed one
    const { password: _, ...userWithoutPassword } = newUser;

    // Fire & forget welcome email (non-blocking)
    sendWelcomeEmail(userWithoutPassword.email, userWithoutPassword.name || undefined).catch(err => {
      console.error('[email] welcome send error', err);
    });

    // Fire & forget referral success email to referrer (if any)
    if (referrerForEmail) {
      const r = referrerForEmail; // narrow for TS
      sendReferralSuccessEmail({
        to: r.email,
        referrerName: r.name || undefined,
        referredEmail: userWithoutPassword.email,
        referralCode: r.referralCode || 'UNKNOWN'
      }).catch(err => console.error('[email] referral-success send error', err));

      // Award heist token to referrer (non-blocking)
      awardToken(r.id, 1)
        .then(() => {
          // Create notification for the referrer
          return createTokenEarnedNotification(
            r.id,
            1,
            userWithoutPassword.name || userWithoutPassword.email
          );
        })
        .catch(err => {
          // Don't fail signup if token award fails
          console.error('[heist] token award error for referral', err);
        });
    }

    // 5. Send back a success response
    res.status(201).json({
      message: 'User created successfully',
      user: userWithoutPassword,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  try {
  const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      // @ts-ignore new field added in migration; prisma generate pending
      select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true, points: true, referralCode: true, role: true }, 
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user owns a merchant
    const merchant = await prisma.merchant.findUnique({
      where: { ownerId: userId! },
      select: { id: true, status: true },
    });

    res.status(200).json({
      ...user,
      merchantId: merchant?.id ?? null,
      merchantStatus: merchant?.status ?? null,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});




// --- Endpoint: POST /api/auth/login ---
const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string(),
});

router.post('/login', async (req: Request, res: Response) => {
  try {
        const { email, password } = loginSchema.parse(req.body);
        
        // Normalize email to lowercase to prevent case sensitivity issues
        const normalizedEmail = email.toLowerCase().trim();

    // 2. Find the user by email
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      // Use a generic error message for security
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Users created via social login may not have a password hash stored
    if (!user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 3. Compare the submitted password with the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 4. Generate a JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in the .env file');
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email }, // This is the JWT payload
      jwtSecret,
      { expiresIn: '24h' } // Token will expire in 24 hours
    );

    // 5. Send the token back to the client
    res.status(200).json({
      message: 'Login successful',
      token: token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
