/**
 * Merchant Loyalty Management Routes
 * 
 * Endpoints for merchants to manage their loyalty programs
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';
import {
  initializeMerchantLoyaltyProgram,
  getMerchantLoyaltyProgram,
  updateMerchantLoyaltyProgram,
  setLoyaltyProgramStatus,
  getMerchantLoyaltyAnalytics,
  awardLoyaltyPoints,
  cancelRedemption
} from '../lib/loyalty';
import prisma from '../lib/prisma';

const router = Router();

// ===== INITIALIZE LOYALTY PROGRAM =====

/**
 * POST /api/merchants/loyalty/initialize
 * Initialize a loyalty program for the merchant
 */
const initializeProgramSchema = z.object({
  pointsPerDollar: z.number().positive().optional(),
  minimumPurchase: z.number().positive().optional(),
  minimumRedemption: z.number().int().positive().optional(),
  redemptionValue: z.number().positive().optional(),
  pointExpirationDays: z.number().int().positive().nullable().optional(),
  allowCombineWithDeals: z.boolean().optional(),
  earnOnDiscounted: z.boolean().optional()
});

router.post('/loyalty/initialize', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const config = initializeProgramSchema.parse(req.body);

    const program = await initializeMerchantLoyaltyProgram(merchantId, config);

    res.status(201).json({
      success: true,
      program,
      message: 'Loyalty program initialized successfully!'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Initialize loyalty program error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const statusCode = message.includes('already exists') ? 409 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: message
    });
  }
});

// ===== GET LOYALTY PROGRAM =====

/**
 * GET /api/merchants/loyalty/program
 * Get merchant's loyalty program configuration
 */
router.get('/loyalty/program', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;

    const program = await getMerchantLoyaltyProgram(merchantId);

    res.status(200).json({
      success: true,
      program
    });
  } catch (error) {
    console.error('Get loyalty program error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const statusCode = message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: message
    });
  }
});

// ===== UPDATE LOYALTY PROGRAM =====

/**
 * PUT /api/merchants/loyalty/program
 * Update merchant's loyalty program configuration
 */
const updateProgramSchema = z.object({
  pointsPerDollar: z.number().positive().optional(),
  minimumPurchase: z.number().positive().optional(),
  minimumRedemption: z.number().int().positive().optional(),
  redemptionValue: z.number().positive().optional(),
  pointExpirationDays: z.number().int().positive().nullable().optional(),
  allowCombineWithDeals: z.boolean().optional(),
  earnOnDiscounted: z.boolean().optional()
});

router.put('/loyalty/program', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const updates = updateProgramSchema.parse(req.body);

    const program = await updateMerchantLoyaltyProgram(merchantId, updates);

    res.status(200).json({
      success: true,
      program,
      message: 'Loyalty program updated successfully!'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Update loyalty program error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ===== ACTIVATE/DEACTIVATE PROGRAM =====

/**
 * PATCH /api/merchants/loyalty/status
 * Activate or deactivate loyalty program
 */
const updateStatusSchema = z.object({
  isActive: z.boolean()
});

router.patch('/loyalty/status', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { isActive } = updateStatusSchema.parse(req.body);

    const program = await setLoyaltyProgramStatus(merchantId, isActive);

    res.status(200).json({
      success: true,
      program,
      message: `Loyalty program ${isActive ? 'activated' : 'deactivated'} successfully!`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Update program status error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ===== GET ANALYTICS =====

/**
 * GET /api/merchants/loyalty/analytics
 * Get loyalty program analytics and statistics
 */
router.get('/loyalty/analytics', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;

    const analytics = await getMerchantLoyaltyAnalytics(merchantId);

    res.status(200).json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Get loyalty analytics error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== GET CUSTOMER BALANCES =====

/**
 * GET /api/merchants/loyalty/customers
 * Get list of customers with loyalty balances
 */
router.get('/loyalty/customers', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sortBy = (req.query.sortBy as string) || 'currentBalance'; // currentBalance, lifetimeEarned, lastEarnedAt
    const order = (req.query.order as string) || 'desc';

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }

    const validSortFields = ['currentBalance', 'lifetimeEarned', 'lifetimeRedeemed', 'lastEarnedAt'];
    if (!validSortFields.includes(sortBy)) {
      return res.status(400).json({
        success: false,
        error: `Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}`
      });
    }

    const customers = await prisma.userMerchantLoyalty.findMany({
      where: { merchantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true
          }
        }
      },
      orderBy: {
        [sortBy]: order === 'asc' ? 'asc' : 'desc'
      },
      take: limit,
      skip: offset
    });

    const total = await prisma.userMerchantLoyalty.count({
      where: { merchantId }
    });

    res.status(200).json({
      success: true,
      customers: customers.map(c => ({
        userId: c.userId,
        userName: c.user.name,
        userEmail: c.user.email,
        userAvatar: c.user.avatarUrl,
        currentBalance: c.currentBalance,
        lifetimeEarned: c.lifetimeEarned,
        lifetimeRedeemed: c.lifetimeRedeemed,
        lastEarnedAt: c.lastEarnedAt,
        lastRedeemedAt: c.lastRedeemedAt,
        tier: c.tier
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ===== MANUAL POINT ADJUSTMENT =====

/**
 * POST /api/merchants/loyalty/adjust-points
 * Manually adjust a customer's points (for corrections, bonuses, etc.)
 */
const adjustPointsSchema = z.object({
  userId: z.number().int().positive(),
  points: z.number().int(),
  reason: z.string().min(5).max(500),
  type: z.enum(['BONUS', 'ADJUSTED', 'REFUNDED']).optional()
});

router.post('/loyalty/adjust-points', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { userId, points, reason, type } = adjustPointsSchema.parse(req.body);

    // Get the loyalty program
    const program = await getMerchantLoyaltyProgram(merchantId);

    // SECURITY: Verify user has an existing loyalty relationship with this merchant
    // Merchants can only adjust points for users who have previously earned loyalty points
    const userLoyalty = await prisma.userMerchantLoyalty.findUnique({
      where: {
        userId_merchantId: { userId, merchantId }
      }
    });

    if (!userLoyalty) {
      return res.status(403).json({
        success: false,
        error: 'User is not a customer of this merchant. Points can only be adjusted for users who have previously earned loyalty points at your business.'
      });
    }

    const balanceBefore = userLoyalty.currentBalance;
    const balanceAfter = balanceBefore + points;

    // Prevent negative balance
    if (balanceAfter < 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot adjust points. Would result in negative balance (${balanceAfter})`
      });
    }

    // Determine transaction type
    let transactionType = type || 'ADJUSTED';
    if (points > 0 && !type) {
      transactionType = 'BONUS';
    }

    // Use a transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // Update user's balance
      const updatedBalance = await tx.userMerchantLoyalty.update({
        where: { id: userLoyalty!.id },
        data: {
          currentBalance: balanceAfter,
          lifetimeEarned: points > 0 
            ? userLoyalty!.lifetimeEarned + points 
            : userLoyalty!.lifetimeEarned,
          lastEarnedAt: points > 0 ? new Date() : userLoyalty!.lastEarnedAt
        }
      });

      // Create transaction record
      const transaction = await tx.loyaltyPointTransaction.create({
        data: {
          userId,
          merchantId,
          loyaltyProgramId: program.id,
          userLoyaltyId: userLoyalty!.id,
          type: transactionType as any,
          points,
          balanceBefore,
          balanceAfter,
          description: `Manual adjustment by merchant: ${reason}`,
          metadata: {
            adjustedBy: 'merchant',
            merchantId,
            reason
          }
        }
      });

      return { updatedBalance, transaction };
    });

    res.status(200).json({
      success: true,
      adjustment: {
        points,
        balanceBefore,
        balanceAfter,
        reason
      },
      transaction: result.transaction,
      message: `Successfully adjusted points by ${points > 0 ? '+' : ''}${points}`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Adjust points error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== CANCEL REDEMPTION =====

/**
 * POST /api/merchants/loyalty/cancel-redemption
 * Cancel a redemption and refund points to customer
 */
const cancelRedemptionSchema = z.object({
  redemptionId: z.number().int().positive(),
  reason: z.string().min(5).max(500)
});

router.post('/loyalty/cancel-redemption', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const { redemptionId, reason } = cancelRedemptionSchema.parse(req.body);

    // Verify redemption belongs to this merchant
    const redemption = await prisma.loyaltyRedemption.findUnique({
      where: { id: redemptionId }
    });

    if (!redemption) {
      return res.status(404).json({
        success: false,
        error: 'Redemption not found'
      });
    }

    if (redemption.merchantId !== merchantId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to cancel this redemption'
      });
    }

    const result = await cancelRedemption(redemptionId, reason);

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation error',
        details: error.issues
      });
    }

    console.error('Cancel redemption error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      success: false,
      error: message
    });
  }
});

// ===== GET RECENT TRANSACTIONS =====

/**
 * GET /api/merchants/loyalty/transactions
 * Get recent loyalty transactions for the merchant
 */
router.get('/loyalty/transactions', protect, isApprovedMerchant, async (req: AuthRequest, res: Response) => {
  try {
    const merchantId = req.merchant!.id;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as string; // Optional filter by type

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100'
      });
    }

    const where: any = { merchantId };
    if (type) {
      where.type = type;
    }

    const transactions = await prisma.loyaltyPointTransaction.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
            finalAmount: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit,
      skip: offset
    });

    const total = await prisma.loyaltyPointTransaction.count({ where });

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
