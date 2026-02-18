// src/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

// Extend Express's Request type to include our custom 'user' property
export interface AuthRequest extends Request {
  user?: { id: number; email: string; };
  merchant?: { id: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' }; // For step 3
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  let token;
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not defined in the .env file');
  }

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, jwtSecret) as { userId: number; email: string };
      req.user = { id: decoded.userId, email: decoded.email };
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Not authorized, no token' });
  }
};

export const isApprovedMerchant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const merchant = await prisma.merchant.findUnique({
      where: { ownerId: userId },
      select: { id: true, status: true },
    });

    if (!merchant) {
      return res.status(403).json({ error: 'You do not have a merchant profile.' });
    }

    if (merchant.status !== 'APPROVED') {
      return res.status(403).json({ error: `Your merchant profile is not approved. Current status: ${merchant.status}` });
    }

    // Attach merchant info to the request for use in the next handler
    req.merchant = merchant;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify merchant status' });
  }
};

// Middleware: require merchant profile (any status - PENDING, APPROVED, etc.)
export const isMerchant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const merchant = await prisma.merchant.findUnique({
      where: { ownerId: userId },
      select: { id: true, status: true },
    });

    if (!merchant) {
      return res.status(403).json({ error: 'You do not have a merchant profile.' });
    }

    // Allow merchants with any status (PENDING, APPROVED, REJECTED, SUSPENDED)
    // Attach merchant info to the request for use in the next handler
    req.merchant = merchant;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify merchant status' });
  }
};

/**
 * Optional auth middleware - populates req.user if a valid token exists,
 * but does NOT reject the request if no token or invalid token.
 */
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, jwtSecret) as { userId: number; email: string };
      req.user = { id: decoded.userId, email: decoded.email };
    } catch {
      // Token invalid/expired — continue as unauthenticated
    }
  }
  next();
};

// Middleware: require ADMIN role
export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to authorize admin' });
  }
};