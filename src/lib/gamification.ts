import prisma from './prisma';
import { CoinTransactionType, LoyaltyTier, AchievementType } from '@prisma/client';

// Loyalty tier thresholds (total spent in USD)
export const LOYALTY_THRESHOLDS = {
  BRONZE: 0,
  SILVER: 50,
  GOLD: 150,
  PLATINUM: 300,
  DIAMOND: 500,
};

// Coin earning rates for different actions
export const COIN_REWARDS = {
  SIGNUP: 50,
  FIRST_CHECKIN: 25,
  CHECKIN: 10,
  DEAL_SAVE: 5,
  REFERRAL: 100,
  ACHIEVEMENT: 25,
};

// Experience points for different actions
export const XP_REWARDS = {
  SIGNUP: 100,
  FIRST_CHECKIN: 50,
  CHECKIN: 20,
  DEAL_SAVE: 10,
  COIN_PURCHASE: 30,
  ACHIEVEMENT: 100,
};

// Calculate loyalty tier based on total spent
export function calculateLoyaltyTier(totalSpent: number): LoyaltyTier {
  if (totalSpent >= LOYALTY_THRESHOLDS.DIAMOND) return LoyaltyTier.DIAMOND;
  if (totalSpent >= LOYALTY_THRESHOLDS.PLATINUM) return LoyaltyTier.PLATINUM;
  if (totalSpent >= LOYALTY_THRESHOLDS.GOLD) return LoyaltyTier.GOLD;
  if (totalSpent >= LOYALTY_THRESHOLDS.SILVER) return LoyaltyTier.SILVER;
  return LoyaltyTier.BRONZE;
}

// Get coin multiplier based on loyalty tier
export function getCoinMultiplier(tier: LoyaltyTier): number {
  const multipliers = {
    BRONZE: 1.0,
    SILVER: 1.2,
    GOLD: 1.5,
    PLATINUM: 1.8,
    DIAMOND: 2.0,
  };
  return multipliers[tier];
}

// Award coins to user with transaction logging
export async function awardCoins(
  userId: number,
  amount: number,
  type: CoinTransactionType,
  description: string,
  metadata?: any,
  relatedPaymentId?: number
) {
  return await prisma.$transaction(async (tx) => {
    return await awardCoinsInTransaction(tx, userId, amount, type, description, metadata, relatedPaymentId);
  });
}

// Award coins within an existing transaction
export async function awardCoinsInTransaction(
  tx: any,
  userId: number,
  amount: number,
  type: CoinTransactionType,
  description: string,
  metadata?: any,
  relatedPaymentId?: number
) {
  // Get current user data
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { coins: true, loyaltyTier: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Apply loyalty tier multiplier for earned coins
  let finalAmount = amount;
  if (type === CoinTransactionType.EARNED) {
    const multiplier = getCoinMultiplier(user.loyaltyTier);
    finalAmount = Math.floor(amount * multiplier);
  }

  const balanceBefore = user.coins;
  const balanceAfter = balanceBefore + finalAmount;

  // Update user coins
  await tx.user.update({
    where: { id: userId },
    data: { coins: balanceAfter },
  });

  // Create transaction record
  const transaction = await tx.coinTransaction.create({
    data: {
      userId,
      type,
      amount: finalAmount,
      balanceBefore,
      balanceAfter,
      description,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      relatedPaymentId,
    },
  });

  return { transaction, balanceAfter, bonusFromTier: finalAmount - amount };
}

// Spend coins from user account
export async function spendCoins(
  userId: number,
  amount: number,
  description: string,
  metadata?: any
) {
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    if (user.coins < amount) {
      throw new Error('Insufficient coins');
    }

    const balanceBefore = user.coins;
    const balanceAfter = balanceBefore - amount;

    await tx.user.update({
      where: { id: userId },
      data: { coins: balanceAfter },
    });

    const transaction = await tx.coinTransaction.create({
      data: {
        userId,
        type: CoinTransactionType.SPENT,
        amount: -amount,
        balanceBefore,
        balanceAfter,
        description,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });

    return { transaction, balanceAfter };
  });
}

// Update user loyalty tier based on spending
export async function updateLoyaltyTier(userId: number, newSpentAmount: number) {
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { totalSpent: true, loyaltyTier: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const newTotalSpent = user.totalSpent + newSpentAmount;
    const newTier = calculateLoyaltyTier(newTotalSpent);
    const tierChanged = newTier !== user.loyaltyTier;

    await tx.user.update({
      where: { id: userId },
      data: {
        totalSpent: newTotalSpent,
        loyaltyTier: newTier,
      },
    });

    // Award bonus coins for tier upgrade
    if (tierChanged && newTier !== LoyaltyTier.BRONZE) {
      const tierBonusCoins = {
        SILVER: 100,
        GOLD: 250,
        PLATINUM: 500,
        DIAMOND: 1000,
      }[newTier] || 0;

      if (tierBonusCoins > 0) {
        await awardCoins(
          userId,
          tierBonusCoins,
          CoinTransactionType.BONUS,
          `Loyalty tier upgrade bonus - Welcome to ${newTier}!`,
          { tierUpgrade: { from: user.loyaltyTier, to: newTier } }
        );
      }
    }

    return { newTier, tierChanged, newTotalSpent };
  });
}

// Award experience points and check for achievements
export async function awardExperience(userId: number, xp: number, source: string) {
  return await prisma.$transaction(async (tx) => {
    return await awardExperienceInTransaction(tx, userId, xp, source);
  });
}

// Award experience points within an existing transaction
export async function awardExperienceInTransaction(tx: any, userId: number, xp: number, source: string) {
  const user = await tx.user.update({
    where: { id: userId },
    data: {
      experiencePoints: {
        increment: xp,
      },
    },
    select: { experiencePoints: true },
  });

  return user.experiencePoints;
}

// Check and award achievements
export async function checkAndAwardAchievements(userId: number, triggerType: string, value?: any) {
  const achievements = await prisma.achievement.findMany({
    where: { isActive: true },
  });

  for (const achievement of achievements) {
    const criteria = achievement.criteria as any;
    
    // Check if user already has this achievement
    const existingAchievement = await prisma.userAchievement.findUnique({
      where: {
        userId_achievementId: {
          userId,
          achievementId: achievement.id,
        },
      },
    });

    if (existingAchievement?.isCompleted) continue;

    let shouldAward = false;
    let currentProgress = existingAchievement?.progress as any || {};

    // Achievement logic based on type
    switch (achievement.type) {
      case AchievementType.FIRST_PURCHASE:
        if (triggerType === 'purchase') {
          shouldAward = true;
        }
        break;

      case AchievementType.SPENDING_MILESTONE:
        if (triggerType === 'spending' && value >= criteria.amount) {
          shouldAward = true;
        }
        break;

      case AchievementType.CHECK_IN_STREAK:
        if (triggerType === 'checkin') {
          // Implementation would require checking consecutive check-ins
          // For now, simplified version
          currentProgress.checkIns = (currentProgress.checkIns || 0) + 1;
          if (currentProgress.checkIns >= criteria.streak) {
            shouldAward = true;
          }
        }
        break;

      case AchievementType.REFERRAL_COUNT:
        if (triggerType === 'referral' && value >= criteria.count) {
          shouldAward = true;
        }
        break;
    }

    if (shouldAward) {
      // Award achievement
      await prisma.userAchievement.upsert({
        where: {
          userId_achievementId: {
            userId,
            achievementId: achievement.id,
          },
        },
        update: {
          isCompleted: true,
          completedAt: new Date(),
          progress: currentProgress,
        },
        create: {
          userId,
          achievementId: achievement.id,
          isCompleted: true,
          completedAt: new Date(),
          progress: currentProgress,
        },
      });

      // Award coins and XP
      if (achievement.coinReward > 0) {
        await awardCoins(
          userId,
          achievement.coinReward,
          CoinTransactionType.BONUS,
          `Achievement unlocked: ${achievement.name}`,
          { achievementId: achievement.id }
        );
      }

      if (achievement.xpReward > 0) {
        await awardExperience(userId, achievement.xpReward, `Achievement: ${achievement.name}`);
      }
    } else if (existingAchievement) {
      // Update progress
      await prisma.userAchievement.update({
        where: { id: existingAchievement.id },
        data: { progress: currentProgress },
      });
    } else {
      // Create progress tracking
      await prisma.userAchievement.create({
        data: {
          userId,
          achievementId: achievement.id,
          progress: currentProgress,
        },
      });
    }
  }
}

// Get user's gamification profile
export async function getUserGamificationProfile(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      coins: true,
      loyaltyTier: true,
      totalSpent: true,
      experiencePoints: true,
      UserAchievement: {
        include: {
          Achievement: true,
        },
        where: {
          isCompleted: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Calculate progress to next tier
  const currentTierIndex = Object.keys(LOYALTY_THRESHOLDS).indexOf(user.loyaltyTier);
  const tierKeys = Object.keys(LOYALTY_THRESHOLDS) as (keyof typeof LOYALTY_THRESHOLDS)[];
  const nextTier = tierKeys[currentTierIndex + 1];
  
  let progressToNextTier = 0;
  let nextTierThreshold = 0;
  
  if (nextTier) {
    nextTierThreshold = LOYALTY_THRESHOLDS[nextTier];
    const currentTierThreshold = LOYALTY_THRESHOLDS[user.loyaltyTier as keyof typeof LOYALTY_THRESHOLDS];
    progressToNextTier = ((user.totalSpent - currentTierThreshold) / (nextTierThreshold - currentTierThreshold)) * 100;
  }

  return {
    coins: user.coins,
    loyaltyTier: user.loyaltyTier,
    totalSpent: user.totalSpent,
    experiencePoints: user.experiencePoints,
    coinMultiplier: getCoinMultiplier(user.loyaltyTier),
    progressToNextTier: Math.min(100, Math.max(0, progressToNextTier)),
    nextTier,
    nextTierThreshold,
    achievements: user.UserAchievement.map((ua: any) => ({
      ...ua.Achievement,
      completedAt: ua.completedAt,
    })),
  };
}