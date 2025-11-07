/**
 * Heist Token Management
 * 
 * Functions for managing user heist tokens (balance, earning, spending).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface TokenBalance {
  balance: number;
  totalEarned: number;
  totalSpent: number;
  lastEarnedAt: Date | null;
  lastSpentAt: Date | null;
}

/**
 * Get a user's token balance and stats
 */
export async function getTokenBalance(userId: number): Promise<TokenBalance> {
  const tokenRecord = await prisma.heistToken.findUnique({
    where: { userId },
  });

  if (!tokenRecord) {
    // User has never earned tokens
    return {
      balance: 0,
      totalEarned: 0,
      totalSpent: 0,
      lastEarnedAt: null,
      lastSpentAt: null,
    };
  }

  return {
    balance: tokenRecord.balance,
    totalEarned: tokenRecord.totalEarned,
    totalSpent: tokenRecord.totalSpent,
    lastEarnedAt: tokenRecord.lastEarnedAt,
    lastSpentAt: tokenRecord.lastSpentAt,
  };
}

/**
 * Award tokens to a user (e.g., from successful referral)
 * Creates token record if it doesn't exist
 */
export async function awardToken(userId: number, amount: number = 1): Promise<TokenBalance> {
  const now = new Date();

  const tokenRecord = await prisma.heistToken.upsert({
    where: { userId },
    create: {
      userId,
      balance: amount,
      totalEarned: amount,
      totalSpent: 0,
      lastEarnedAt: now,
      lastSpentAt: null,
    },
    update: {
      balance: { increment: amount },
      totalEarned: { increment: amount },
      lastEarnedAt: now,
    },
  });

  return {
    balance: tokenRecord.balance,
    totalEarned: tokenRecord.totalEarned,
    totalSpent: tokenRecord.totalSpent,
    lastEarnedAt: tokenRecord.lastEarnedAt,
    lastSpentAt: tokenRecord.lastSpentAt,
  };
}

/**
 * Spend tokens (e.g., to perform a heist)
 * Must be called within a transaction in the heist execution flow
 * 
 * @throws Error if user doesn't have enough tokens
 */
export async function spendToken(
  userId: number,
  amount: number = 1,
  tx?: PrismaClient
): Promise<TokenBalance> {
  const client = tx || prisma;
  const now = new Date();

  // Get current balance with row lock (if in transaction)
  const currentRecord = await client.heistToken.findUnique({
    where: { userId },
  });

  if (!currentRecord || currentRecord.balance < amount) {
    throw new Error('INSUFFICIENT_TOKENS');
  }

  // Deduct tokens
  const updatedRecord = await client.heistToken.update({
    where: { userId },
    data: {
      balance: { decrement: amount },
      totalSpent: { increment: amount },
      lastSpentAt: now,
    },
  });

  return {
    balance: updatedRecord.balance,
    totalEarned: updatedRecord.totalEarned,
    totalSpent: updatedRecord.totalSpent,
    lastEarnedAt: updatedRecord.lastEarnedAt,
    lastSpentAt: updatedRecord.lastSpentAt,
  };
}

/**
 * Check if a user has enough tokens
 */
export async function hasTokens(userId: number, amount: number = 1): Promise<boolean> {
  const tokenRecord = await prisma.heistToken.findUnique({
    where: { userId },
    select: { balance: true },
  });

  return tokenRecord ? tokenRecord.balance >= amount : false;
}

/**
 * Get token leaderboard (users with most tokens)
 */
export async function getTokenLeaderboard(limit: number = 10): Promise<Array<{
  userId: number;
  balance: number;
  totalEarned: number;
}>> {
  const topUsers = await prisma.heistToken.findMany({
    where: {
      balance: { gt: 0 },
    },
    orderBy: {
      balance: 'desc',
    },
    take: limit,
    select: {
      userId: true,
      balance: true,
      totalEarned: true,
    },
  });

  return topUsers;
}
