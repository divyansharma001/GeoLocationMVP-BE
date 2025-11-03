/**
 * Streak Routes
 * API endpoints for managing user check-in streaks and discounts
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import {
  getStreakInfo,
  updateStreakAfterCheckIn,
  getStreakLeaderboard,
  applyStreakDiscount,
  calculateDiscountPercentage,
} from '../lib/streak';

const router = Router();

/**
 * GET /api/streak
 * Get current user's streak information
 */
router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const streakInfo = await getStreakInfo(userId);

    res.status(200).json({
      success: true,
      streak: streakInfo,
      message: `Current streak: ${streakInfo.currentStreak} weeks with ${streakInfo.currentDiscountPercent}% discount`,
    });
  } catch (error) {
    console.error('Get streak error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /api/streak/leaderboard
 * Get streak leaderboard
 */
router.get('/leaderboard', async (req, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ 
        success: false,
        error: 'Limit must be between 1 and 100' 
      });
    }

    const leaderboard = await getStreakLeaderboard(limit);

    res.status(200).json({
      success: true,
      leaderboard: leaderboard.map(entry => ({
        userId: entry.userId,
        user: {
          id: entry.user.id,
          name: entry.user.name,
          email: entry.user.email,
          avatarUrl: entry.user.avatarUrl,
        },
        currentStreak: entry.currentStreak,
        longestStreak: entry.longestStreak,
        totalCheckIns: entry.totalCheckIns,
        currentDiscountPercent: entry.currentDiscountPercent,
        maxDiscountReached: entry.maxDiscountReached,
      })),
      total: leaderboard.length,
    });
  } catch (error) {
    console.error('Get streak leaderboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * POST /api/streak/calculate-discount
 * Calculate discount for a given order amount
 */
const calculateDiscountSchema = z.object({
  orderAmount: z.number().positive({ message: 'Order amount must be positive' }),
});

router.post('/calculate-discount', protect, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = calculateDiscountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        success: false,
        errors: parsed.error.issues 
      });
    }

    const { orderAmount } = parsed.data;
    const userId = req.user!.id;
    
    const streakInfo = await getStreakInfo(userId);
    const discountDetails = applyStreakDiscount(
      orderAmount, 
      streakInfo.currentDiscountPercent
    );

    res.status(200).json({
      success: true,
      discount: discountDetails,
      streak: {
        currentStreak: streakInfo.currentStreak,
        currentDiscountPercent: streakInfo.currentDiscountPercent,
        maxDiscountReached: streakInfo.maxDiscountReached,
      },
    });
  } catch (error) {
    console.error('Calculate discount error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

/**
 * GET /api/streak/discount-tiers
 * Get information about discount tiers
 */
router.get('/discount-tiers', (req, res: Response) => {
  try {
    const tiers = [];
    for (let week = 1; week <= 7; week++) {
      const discount = calculateDiscountPercentage(week);
      tiers.push({
        week,
        discountPercent: discount,
        description: week === 1 
          ? 'First week - Base discount' 
          : week >= 7 
          ? 'Maximum discount reached!' 
          : `Week ${week} bonus`,
      });
    }

    res.status(200).json({
      success: true,
      tiers,
      maxWeeks: 7,
      maxDiscount: 45,
      description: 'Check in every week to increase your discount! Starts at 10% and increases by 5% each consecutive week, up to 45% after 7 weeks.',
    });
  } catch (error) {
    console.error('Get discount tiers error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

export default router;
