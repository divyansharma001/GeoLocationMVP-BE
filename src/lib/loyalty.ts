/**
 * Loyalty Points System - Business Logic
 * 
 * Core functions for managing merchant-specific loyalty points:
 * - Earning: $5 spent = 2 loyalty points (0.4 points per dollar)
 * - Redemption: 25 points = $5 discount minimum
 */

import prisma from './prisma';
import { 
  LoyaltyTransactionType, 
  LoyaltyRedemptionStatus, 
  OrderStatus,
  Prisma 
} from '@prisma/client';

// ===== TYPES AND INTERFACES =====

export interface LoyaltyProgramConfig {
  pointsPerDollar: number;
  minimumPurchase: number;
  minimumRedemption: number;
  redemptionValue: number;
  pointExpirationDays?: number | null;
  allowCombineWithDeals: boolean;
  earnOnDiscounted: boolean;
}

export interface PointCalculation {
  orderAmount: number;
  pointsEarned: number;
  pointsPerDollar: number;
  calculation: string;
}

export interface RedemptionCalculation {
  pointsToRedeem: number;
  discountValue: number;
  remainingPoints: number;
  calculation: string;
}

export interface LoyaltyBalance {
  userId: number;
  merchantId: number;
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lastEarnedAt: Date | null;
  lastRedeemedAt: Date | null;
  tier: string | null;
  merchantName: string;
  programConfig: LoyaltyProgramConfig;
}

export interface RedemptionValidation {
  valid: boolean;
  error?: string;
  availablePoints?: number;
  minimumRequired?: number;
  discountValue?: number;
}

// ===== DEFAULT CONFIGURATION =====

export const DEFAULT_LOYALTY_CONFIG: LoyaltyProgramConfig = {
  pointsPerDollar: 0.4,        // 2 points per $5
  minimumPurchase: 0.01,       // Min $0.01 to earn points
  minimumRedemption: 25,       // Min 25 points to redeem
  redemptionValue: 5.0,        // 25 points = $5
  pointExpirationDays: null,   // No expiration by default
  allowCombineWithDeals: true, // Can combine with deals
  earnOnDiscounted: false      // Earn points on original amount
};

// ===== LOYALTY PROGRAM MANAGEMENT =====

/**
 * Initialize a loyalty program for a merchant
 */
export async function initializeMerchantLoyaltyProgram(
  merchantId: number,
  config?: Partial<LoyaltyProgramConfig>
) {
  // Check if program already exists
  const existing = await prisma.merchantLoyaltyProgram.findUnique({
    where: { merchantId }
  });

  if (existing) {
    throw new Error('Loyalty program already exists for this merchant');
  }

  const finalConfig = { ...DEFAULT_LOYALTY_CONFIG, ...config };

  const program = await prisma.merchantLoyaltyProgram.create({
    data: {
      merchantId,
      isActive: true,
      pointsPerDollar: finalConfig.pointsPerDollar,
      minimumPurchase: finalConfig.minimumPurchase,
      minimumRedemption: finalConfig.minimumRedemption,
      redemptionValue: finalConfig.redemptionValue,
      pointExpirationDays: finalConfig.pointExpirationDays,
      allowCombineWithDeals: finalConfig.allowCombineWithDeals,
      earnOnDiscounted: finalConfig.earnOnDiscounted
    }
  });

  return program;
}

/**
 * Get merchant's loyalty program configuration
 */
export async function getMerchantLoyaltyProgram(merchantId: number) {
  const program = await prisma.merchantLoyaltyProgram.findUnique({
    where: { merchantId },
    include: {
      merchant: {
        select: {
          id: true,
          businessName: true,
          status: true
        }
      }
    }
  });

  if (!program) {
    throw new Error('Loyalty program not found for this merchant');
  }

  if (!program.isActive) {
    throw new Error('Loyalty program is not active');
  }

  return program;
}

/**
 * Update merchant's loyalty program configuration
 */
export async function updateMerchantLoyaltyProgram(
  merchantId: number,
  updates: Partial<LoyaltyProgramConfig>
) {
  const program = await prisma.merchantLoyaltyProgram.update({
    where: { merchantId },
    data: updates
  });

  return program;
}

/**
 * Activate or deactivate a loyalty program
 */
export async function setLoyaltyProgramStatus(
  merchantId: number,
  isActive: boolean
) {
  const program = await prisma.merchantLoyaltyProgram.update({
    where: { merchantId },
    data: { isActive }
  });

  return program;
}

// ===== POINT CALCULATION =====

/**
 * Calculate loyalty points for a purchase amount
 * Formula: floor(amount / 5) * 2 = floor(amount * 0.4)
 */
export function calculateLoyaltyPoints(
  amount: number,
  pointsPerDollar: number = 0.4
): PointCalculation {
  if (amount <= 0) {
    return {
      orderAmount: amount,
      pointsEarned: 0,
      pointsPerDollar,
      calculation: 'Amount must be greater than 0'
    };
  }

  // Calculate points and floor the result
  const pointsEarned = Math.floor(amount * pointsPerDollar);

  return {
    orderAmount: amount,
    pointsEarned,
    pointsPerDollar,
    calculation: `floor(${amount} × ${pointsPerDollar}) = ${pointsEarned} points`
  };
}

/**
 * Calculate discount value for points to redeem
 * Formula: (points / 25) * 5
 */
export function calculateRedemptionValue(
  pointsToRedeem: number,
  minimumRedemption: number = 25,
  redemptionValue: number = 5.0
): RedemptionCalculation {
  if (pointsToRedeem < minimumRedemption) {
    return {
      pointsToRedeem,
      discountValue: 0,
      remainingPoints: pointsToRedeem,
      calculation: `Minimum ${minimumRedemption} points required`
    };
  }

  // Calculate how many redemption units
  const redemptionUnits = Math.floor(pointsToRedeem / minimumRedemption);
  const actualPointsUsed = redemptionUnits * minimumRedemption;
  const discountValue = redemptionUnits * redemptionValue;
  const remainingPoints = pointsToRedeem - actualPointsUsed;

  return {
    pointsToRedeem: actualPointsUsed,
    discountValue,
    remainingPoints,
    calculation: `${redemptionUnits} × $${redemptionValue} = $${discountValue} (${actualPointsUsed} points used, ${remainingPoints} remaining)`
  };
}

// ===== USER LOYALTY BALANCE =====

/**
 * Get or create user's loyalty balance for a merchant
 */
export async function getUserLoyaltyBalance(
  userId: number,
  merchantId: number
): Promise<LoyaltyBalance> {
  // Get the loyalty program
  const program = await getMerchantLoyaltyProgram(merchantId);

  // Get or create user's balance
  let userLoyalty = await prisma.userMerchantLoyalty.findUnique({
    where: {
      userId_merchantId: { userId, merchantId }
    },
    include: {
      merchant: {
        select: {
          businessName: true
        }
      }
    }
  });

  // If doesn't exist, create it
  if (!userLoyalty) {
    userLoyalty = await prisma.userMerchantLoyalty.create({
      data: {
        userId,
        merchantId,
        loyaltyProgramId: program.id,
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0
      },
      include: {
        merchant: {
          select: {
            businessName: true
          }
        }
      }
    });
  }

  return {
    userId: userLoyalty.userId,
    merchantId: userLoyalty.merchantId,
    currentBalance: userLoyalty.currentBalance,
    lifetimeEarned: userLoyalty.lifetimeEarned,
    lifetimeRedeemed: userLoyalty.lifetimeRedeemed,
    lastEarnedAt: userLoyalty.lastEarnedAt,
    lastRedeemedAt: userLoyalty.lastRedeemedAt,
    tier: userLoyalty.tier,
    merchantName: userLoyalty.merchant.businessName,
    programConfig: {
      pointsPerDollar: program.pointsPerDollar,
      minimumPurchase: program.minimumPurchase,
      minimumRedemption: program.minimumRedemption,
      redemptionValue: program.redemptionValue,
      pointExpirationDays: program.pointExpirationDays,
      allowCombineWithDeals: program.allowCombineWithDeals,
      earnOnDiscounted: program.earnOnDiscounted
    }
  };
}

/**
 * Get all loyalty balances for a user across all merchants
 */
export async function getAllUserLoyaltyBalances(userId: number) {
  const balances = await prisma.userMerchantLoyalty.findMany({
    where: { userId },
    include: {
      merchant: {
        select: {
          id: true,
          businessName: true,
          logoUrl: true,
          address: true
        }
      },
      loyaltyProgram: true
    },
    orderBy: {
      currentBalance: 'desc'
    }
  });

  return balances.map(balance => ({
    userId: balance.userId,
    merchantId: balance.merchantId,
    currentBalance: balance.currentBalance,
    lifetimeEarned: balance.lifetimeEarned,
    lifetimeRedeemed: balance.lifetimeRedeemed,
    lastEarnedAt: balance.lastEarnedAt,
    lastRedeemedAt: balance.lastRedeemedAt,
    tier: balance.tier,
    merchantName: balance.merchant.businessName,
    merchantLogo: balance.merchant.logoUrl,
    merchantAddress: balance.merchant.address,
    programConfig: {
      pointsPerDollar: balance.loyaltyProgram.pointsPerDollar,
      minimumPurchase: balance.loyaltyProgram.minimumPurchase,
      minimumRedemption: balance.loyaltyProgram.minimumRedemption,
      redemptionValue: balance.loyaltyProgram.redemptionValue,
      pointExpirationDays: balance.loyaltyProgram.pointExpirationDays,
      allowCombineWithDeals: balance.loyaltyProgram.allowCombineWithDeals,
      earnOnDiscounted: balance.loyaltyProgram.earnOnDiscounted
    }
  }));
}

// ===== POINT EARNING =====

/**
 * Award loyalty points to a user for a purchase
 */
export async function awardLoyaltyPoints(
  userId: number,
  merchantId: number,
  orderId: number,
  amount: number,
  description?: string
) {
  // Get the loyalty program
  const program = await getMerchantLoyaltyProgram(merchantId);

  // Check minimum purchase
  if (amount < program.minimumPurchase) {
    throw new Error(`Minimum purchase of $${program.minimumPurchase} required to earn points`);
  }

  // Calculate points
  const calculation = calculateLoyaltyPoints(amount, program.pointsPerDollar);
  const pointsEarned = calculation.pointsEarned;

  if (pointsEarned === 0) {
    // No points earned, but not an error
    return {
      pointsEarned: 0,
      message: 'Purchase amount too small to earn points',
      calculation
    };
  }

  // Get or create user's loyalty balance
  let userLoyalty = await prisma.userMerchantLoyalty.findUnique({
    where: {
      userId_merchantId: { userId, merchantId }
    }
  });

  if (!userLoyalty) {
    userLoyalty = await prisma.userMerchantLoyalty.create({
      data: {
        userId,
        merchantId,
        loyaltyProgramId: program.id,
        currentBalance: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0
      }
    });
  }

  const balanceBefore = userLoyalty.currentBalance;
  const balanceAfter = balanceBefore + pointsEarned;

  // Use a transaction to ensure consistency
  const result = await prisma.$transaction(async (tx) => {
    // Update user's balance
    const updatedBalance = await tx.userMerchantLoyalty.update({
      where: { id: userLoyalty!.id },
      data: {
        currentBalance: balanceAfter,
        lifetimeEarned: userLoyalty!.lifetimeEarned + pointsEarned,
        lastEarnedAt: new Date()
      }
    });

    // Create transaction record
    const transaction = await tx.loyaltyPointTransaction.create({
      data: {
        userId,
        merchantId,
        loyaltyProgramId: program.id,
        userLoyaltyId: userLoyalty!.id,
        type: LoyaltyTransactionType.EARNED,
        points: pointsEarned,
        balanceBefore,
        balanceAfter,
        description: description || `Earned ${pointsEarned} points from $${amount.toFixed(2)} purchase`,
        metadata: {
          orderAmount: amount,
          calculation: calculation.calculation
        },
        relatedOrderId: orderId
      }
    });

    return { updatedBalance, transaction };
  });

  return {
    pointsEarned,
    balanceBefore,
    balanceAfter,
    calculation,
    transaction: result.transaction,
    message: `Successfully earned ${pointsEarned} points!`
  };
}

// ===== POINT REDEMPTION =====

/**
 * Validate if a redemption is allowed
 */
export async function validateRedemption(
  userId: number,
  merchantId: number,
  pointsToRedeem: number,
  orderAmount?: number
): Promise<RedemptionValidation> {
  // Get the loyalty program
  let program;
  try {
    program = await getMerchantLoyaltyProgram(merchantId);
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Loyalty program not found'
    };
  }

  // Get user's balance
  const balance = await getUserLoyaltyBalance(userId, merchantId);

  // Check if user has enough points
  if (balance.currentBalance < pointsToRedeem) {
    return {
      valid: false,
      error: `Insufficient points. You have ${balance.currentBalance} points, need ${pointsToRedeem}`,
      availablePoints: balance.currentBalance,
      minimumRequired: pointsToRedeem
    };
  }

  // Check minimum redemption
  if (pointsToRedeem < program.minimumRedemption) {
    return {
      valid: false,
      error: `Minimum ${program.minimumRedemption} points required for redemption`,
      availablePoints: balance.currentBalance,
      minimumRequired: program.minimumRedemption
    };
  }

  // Calculate discount value
  const redemptionCalc = calculateRedemptionValue(
    pointsToRedeem,
    program.minimumRedemption,
    program.redemptionValue
  );

  // Check if discount exceeds order amount (if provided)
  if (orderAmount && redemptionCalc.discountValue > orderAmount) {
    return {
      valid: false,
      error: `Discount value ($${redemptionCalc.discountValue}) cannot exceed order amount ($${orderAmount})`,
      availablePoints: balance.currentBalance,
      discountValue: redemptionCalc.discountValue
    };
  }

  return {
    valid: true,
    availablePoints: balance.currentBalance,
    discountValue: redemptionCalc.discountValue
  };
}

/**
 * Redeem loyalty points for a discount
 */
export async function redeemLoyaltyPoints(
  userId: number,
  merchantId: number,
  pointsToRedeem: number,
  orderId?: number,
  orderAmount?: number
) {
  // Validate redemption
  const validation = await validateRedemption(userId, merchantId, pointsToRedeem, orderAmount);
  
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Get the loyalty program
  const program = await getMerchantLoyaltyProgram(merchantId);

  // Calculate actual redemption
  const redemptionCalc = calculateRedemptionValue(
    pointsToRedeem,
    program.minimumRedemption,
    program.redemptionValue
  );

  const actualPointsUsed = redemptionCalc.pointsToRedeem;
  const discountValue = redemptionCalc.discountValue;

  // Get user's loyalty balance
  const userLoyalty = await prisma.userMerchantLoyalty.findUnique({
    where: {
      userId_merchantId: { userId, merchantId }
    }
  });

  if (!userLoyalty) {
    throw new Error('User loyalty balance not found');
  }

  const balanceBefore = userLoyalty.currentBalance;
  const balanceAfter = balanceBefore - actualPointsUsed;

  // Use a transaction to ensure consistency
  const result = await prisma.$transaction(async (tx) => {
    // Update user's balance
    const updatedBalance = await tx.userMerchantLoyalty.update({
      where: { id: userLoyalty.id },
      data: {
        currentBalance: balanceAfter,
        lifetimeRedeemed: userLoyalty.lifetimeRedeemed + actualPointsUsed,
        lastRedeemedAt: new Date()
      }
    });

    // Create redemption record
    const redemption = await tx.loyaltyRedemption.create({
      data: {
        userId,
        merchantId,
        loyaltyProgramId: program.id,
        userLoyaltyId: userLoyalty.id,
        pointsUsed: actualPointsUsed,
        discountValue,
        orderId,
        status: orderId ? LoyaltyRedemptionStatus.APPLIED : LoyaltyRedemptionStatus.PENDING,
        appliedAt: orderId ? new Date() : null,
        metadata: {
          calculation: redemptionCalc.calculation,
          orderAmount
        }
      }
    });

    // Create transaction record
    const transaction = await tx.loyaltyPointTransaction.create({
      data: {
        userId,
        merchantId,
        loyaltyProgramId: program.id,
        userLoyaltyId: userLoyalty.id,
        type: LoyaltyTransactionType.REDEEMED,
        points: -actualPointsUsed,
        balanceBefore,
        balanceAfter,
        description: `Redeemed ${actualPointsUsed} points for $${discountValue.toFixed(2)} discount`,
        metadata: {
          discountValue,
          calculation: redemptionCalc.calculation
        },
        relatedOrderId: orderId,
        relatedRedemptionId: redemption.id
      }
    });

    return { updatedBalance, redemption, transaction };
  });

  return {
    pointsRedeemed: actualPointsUsed,
    discountValue,
    balanceBefore,
    balanceAfter,
    remainingPoints: redemptionCalc.remainingPoints,
    redemption: result.redemption,
    transaction: result.transaction,
    message: `Successfully redeemed ${actualPointsUsed} points for $${discountValue.toFixed(2)} discount!`
  };
}

/**
 * Cancel a redemption and refund points
 */
export async function cancelRedemption(
  redemptionId: number,
  reason: string
) {
  const redemption = await prisma.loyaltyRedemption.findUnique({
    where: { id: redemptionId }
  });

  if (!redemption) {
    throw new Error('Redemption not found');
  }

  if (redemption.status === LoyaltyRedemptionStatus.CANCELLED) {
    throw new Error('Redemption already cancelled');
  }

  const userLoyalty = await prisma.userMerchantLoyalty.findUnique({
    where: { id: redemption.userLoyaltyId }
  });

  if (!userLoyalty) {
    throw new Error('User loyalty balance not found');
  }

  const balanceBefore = userLoyalty.currentBalance;
  const balanceAfter = balanceBefore + redemption.pointsUsed;

  // Use a transaction to ensure consistency
  const result = await prisma.$transaction(async (tx) => {
    // Update redemption status
    const updatedRedemption = await tx.loyaltyRedemption.update({
      where: { id: redemptionId },
      data: {
        status: LoyaltyRedemptionStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason
      }
    });

    // Refund points
    const updatedBalance = await tx.userMerchantLoyalty.update({
      where: { id: userLoyalty.id },
      data: {
        currentBalance: balanceAfter,
        lifetimeRedeemed: userLoyalty.lifetimeRedeemed - redemption.pointsUsed
      }
    });

    // Create refund transaction
    const transaction = await tx.loyaltyPointTransaction.create({
      data: {
        userId: redemption.userId,
        merchantId: redemption.merchantId,
        loyaltyProgramId: redemption.loyaltyProgramId,
        userLoyaltyId: userLoyalty.id,
        type: LoyaltyTransactionType.REFUNDED,
        points: redemption.pointsUsed,
        balanceBefore,
        balanceAfter,
        description: `Points refunded from cancelled redemption: ${reason}`,
        metadata: {
          originalRedemptionId: redemptionId,
          reason
        },
        relatedRedemptionId: redemptionId
      }
    });

    return { updatedRedemption, updatedBalance, transaction };
  });

  return {
    pointsRefunded: redemption.pointsUsed,
    balanceBefore,
    balanceAfter,
    message: `Redemption cancelled. ${redemption.pointsUsed} points refunded.`
  };
}

// ===== TRANSACTION HISTORY =====

/**
 * Get user's loyalty transaction history for a merchant
 */
export async function getUserLoyaltyTransactions(
  userId: number,
  merchantId: number,
  limit: number = 50,
  offset: number = 0
) {
  const transactions = await prisma.loyaltyPointTransaction.findMany({
    where: {
      userId,
      merchantId
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          finalAmount: true,
          createdAt: true
        }
      },
      redemption: {
        select: {
          id: true,
          discountValue: true,
          status: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: limit,
    skip: offset
  });

  const total = await prisma.loyaltyPointTransaction.count({
    where: {
      userId,
      merchantId
    }
  });

  return {
    transactions,
    total,
    limit,
    offset,
    hasMore: offset + limit < total
  };
}

/**
 * Get merchant's loyalty analytics
 */
export async function getMerchantLoyaltyAnalytics(merchantId: number) {
  const program = await getMerchantLoyaltyProgram(merchantId);

  // Get total users with balances
  const totalUsers = await prisma.userMerchantLoyalty.count({
    where: { merchantId }
  });

  // Get active users (with balance > 0)
  const activeUsers = await prisma.userMerchantLoyalty.count({
    where: {
      merchantId,
      currentBalance: { gt: 0 }
    }
  });

  // Get total points issued
  const pointsIssued = await prisma.loyaltyPointTransaction.aggregate({
    where: {
      merchantId,
      type: LoyaltyTransactionType.EARNED
    },
    _sum: {
      points: true
    }
  });

  // Get total points redeemed
  const pointsRedeemed = await prisma.loyaltyPointTransaction.aggregate({
    where: {
      merchantId,
      type: LoyaltyTransactionType.REDEEMED
    },
    _sum: {
      points: true
    }
  });

  // Get total discount value given
  const totalDiscounts = await prisma.loyaltyRedemption.aggregate({
    where: {
      merchantId,
      status: LoyaltyRedemptionStatus.APPLIED
    },
    _sum: {
      discountValue: true
    }
  });

  // Get recent redemptions
  const recentRedemptions = await prisma.loyaltyRedemption.findMany({
    where: { merchantId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      }
    },
    orderBy: {
      redeemedAt: 'desc'
    },
    take: 10
  });

  return {
    program: {
      isActive: program.isActive,
      pointsPerDollar: program.pointsPerDollar,
      minimumRedemption: program.minimumRedemption,
      redemptionValue: program.redemptionValue
    },
    users: {
      total: totalUsers,
      active: activeUsers,
      inactivePercent: totalUsers > 0 ? ((totalUsers - activeUsers) / totalUsers * 100).toFixed(2) : '0'
    },
    points: {
      issued: Math.abs(pointsIssued._sum.points || 0),
      redeemed: Math.abs(pointsRedeemed._sum.points || 0),
      outstanding: Math.abs(pointsIssued._sum.points || 0) - Math.abs(pointsRedeemed._sum.points || 0)
    },
    discounts: {
      totalValue: totalDiscounts._sum.discountValue || 0,
      averagePerRedemption: recentRedemptions.length > 0 
        ? (totalDiscounts._sum.discountValue || 0) / recentRedemptions.length 
        : 0
    },
    recentRedemptions
  };
}
