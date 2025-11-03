/**
 * Loyalty Points System API Routes
 * 
 * User-facing endpoints for managing loyalty points
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import {
  getUserLoyaltyBalance,
  getAllUserLoyaltyBalances,
  calculateLoyaltyPoints,
  calculateRedemptionValue,
  validateRedemption,
  getUserLoyaltyTransactions,
  getMerchantLoyaltyProgram
} from '../lib/loyalty';

const router = Router();

// ===== GET USER'S LOYALTY BALANCE FOR A MERCHANT =====

/**
 * GET /api/loyalty/balance/:merchantId
 * Get user's loyalty points balance for a specific merchant
 */
router.get('/balance/:merchantId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid merchant ID'
      });
    }

    const balance = await getUserLoyaltyBalance(userId, merchantId);

    res.status(200).json({
      success: true,
      balance
    });
  } catch (error) {
    console.error('Get loyalty balance error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== GET ALL USER'S LOYALTY BALANCES =====

/**
 * GET /api/loyalty/balances
 * Get user's loyalty points across all merchants
 */
router.get('/balances', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const balances = await getAllUserLoyaltyBalances(userId);

    res.status(200).json({
      success: true,
      balances,
      total: balances.length,
      totalPoints: balances.reduce((sum, b) => sum + b.currentBalance, 0)
    });
  } catch (error) {
    console.error('Get all loyalty balances error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ===== CALCULATE POINTS FOR PURCHASE =====

/**
 * POST /api/loyalty/calculate-points
 * Calculate how many points would be earned for a purchase amount
 */
const calculatePointsSchema = z.object({
  merchantId: z.number().int().positive(),
  amount: z.number().positive()
});

router.post('/calculate-points', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { merchantId, amount } = calculatePointsSchema.parse(req.body);

    // Get merchant's loyalty program to get the points per dollar rate
    const program = await getMerchantLoyaltyProgram(merchantId);

    const calculation = calculateLoyaltyPoints(amount, program.pointsPerDollar);

    res.status(200).json({
      success: true,
      calculation,
      merchantId,
      programConfig: {
        pointsPerDollar: program.pointsPerDollar,
        minimumPurchase: program.minimumPurchase
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Calculate points error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== CALCULATE REDEMPTION VALUE =====

/**
 * POST /api/loyalty/calculate-redemption
 * Calculate discount value for a given number of points
 */
const calculateRedemptionSchema = z.object({
  merchantId: z.number().int().positive(),
  points: z.number().int().positive()
});

router.post('/calculate-redemption', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { merchantId, points } = calculateRedemptionSchema.parse(req.body);

    // Get merchant's loyalty program
    const program = await getMerchantLoyaltyProgram(merchantId);

    const calculation = calculateRedemptionValue(
      points,
      program.minimumRedemption,
      program.redemptionValue
    );

    res.status(200).json({
      success: true,
      calculation,
      merchantId,
      programConfig: {
        minimumRedemption: program.minimumRedemption,
        redemptionValue: program.redemptionValue
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Calculate redemption error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== GET REDEMPTION OPTIONS =====

/**
 * GET /api/loyalty/redemption-options/:merchantId
 * Get available redemption tiers for a merchant
 */
router.get('/redemption-options/:merchantId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid merchant ID'
      });
    }

    // Get user's balance
    const balance = await getUserLoyaltyBalance(userId, merchantId);

    // Get program config
    const program = await getMerchantLoyaltyProgram(merchantId);

    // Generate redemption tiers (25pts=$5, 50pts=$10, 75pts=$15, etc.)
    const tiers = [];
    const maxTiers = 10; // Show up to 10 redemption options
    
    for (let i = 1; i <= maxTiers; i++) {
      const points = program.minimumRedemption * i;
      const value = program.redemptionValue * i;
      
      // Only show tiers user can afford or up to 2 levels above current balance
      if (points <= balance.currentBalance + (program.minimumRedemption * 2)) {
        tiers.push({
          points,
          value,
          available: points <= balance.currentBalance,
          pointsNeeded: points > balance.currentBalance ? points - balance.currentBalance : 0
        });
      }
    }

    res.status(200).json({
      success: true,
      currentBalance: balance.currentBalance,
      merchantName: balance.merchantName,
      tiers,
      programConfig: {
        minimumRedemption: program.minimumRedemption,
        redemptionValue: program.redemptionValue,
        pointsPerDollar: program.pointsPerDollar
      }
    });
  } catch (error) {
    console.error('Get redemption options error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== VALIDATE REDEMPTION =====

/**
 * POST /api/loyalty/validate-redemption
 * Validate if a redemption is possible
 */
const validateRedemptionSchema = z.object({
  merchantId: z.number().int().positive(),
  points: z.number().int().positive(),
  orderAmount: z.number().positive().optional()
});

router.post('/validate-redemption', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { merchantId, points, orderAmount } = validateRedemptionSchema.parse(req.body);

    const validation = await validateRedemption(userId, merchantId, points, orderAmount);

    res.status(200).json({
      success: true,
      validation
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Validate redemption error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== GET TRANSACTION HISTORY =====

/**
 * GET /api/loyalty/transactions/:merchantId
 * Get user's loyalty transaction history for a merchant
 */
router.get('/transactions/:merchantId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const merchantId = parseInt(req.params.merchantId);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid merchant ID'
      });
    }

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }

    const result = await getUserLoyaltyTransactions(userId, merchantId, limit, offset);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ===== GET LOYALTY PROGRAM INFO =====

/**
 * GET /api/loyalty/program/:merchantId
 * Get merchant's loyalty program information
 */
router.get('/program/:merchantId', async (req, res: Response) => {
  try {
    const merchantId = parseInt(req.params.merchantId);

    if (isNaN(merchantId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid merchant ID'
      });
    }

    const program = await getMerchantLoyaltyProgram(merchantId);

    res.status(200).json({
      success: true,
      program: {
        merchantId: program.merchantId,
        merchantName: program.merchant.businessName,
        isActive: program.isActive,
        pointsPerDollar: program.pointsPerDollar,
        minimumPurchase: program.minimumPurchase,
        minimumRedemption: program.minimumRedemption,
        redemptionValue: program.redemptionValue,
        pointExpirationDays: program.pointExpirationDays,
        allowCombineWithDeals: program.allowCombineWithDeals,
        earnOnDiscounted: program.earnOnDiscounted,
        description: `Earn ${Math.floor(program.pointsPerDollar * 5)} points for every $5 spent. Redeem ${program.minimumRedemption} points for $${program.redemptionValue} off your order!`
      }
    });
  } catch (error) {
    console.error('Get program info error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

export default router;
