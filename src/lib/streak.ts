/**
 * Streak Service
 * Manages user check-in streaks and discount calculations
 * 
 * Streak Rules:
 * - Base discount: 10% for first week
 * - Increases by 5% each consecutive week
 * - Maximum discount: 45% (after 7+ weeks)
 * - Resets if user misses a week
 */

import prisma from './prisma';

export interface StreakConfig {
  baseDiscountPercent: number;
  discountIncrementPerWeek: number;
  maxDiscountPercent: number;
  maxStreakWeeks: number;
}

const DEFAULT_STREAK_CONFIG: StreakConfig = {
  baseDiscountPercent: 10,
  discountIncrementPerWeek: 5,
  maxDiscountPercent: 45,
  maxStreakWeeks: 7,
};

/**
 * Get the current week number (0-6 for Sunday-Saturday)
 */
function getWeekNumber(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  return Math.floor((days + startOfYear.getDay()) / 7);
}

/**
 * Check if two dates are in the same week
 */
function isSameWeek(date1: Date, date2: Date): boolean {
  const week1 = getWeekNumber(date1);
  const week2 = getWeekNumber(date2);
  const year1 = date1.getFullYear();
  const year2 = date2.getFullYear();
  return week1 === week2 && year1 === year2;
}

/**
 * Check if date2 is the week after date1
 */
function isConsecutiveWeek(date1: Date, date2: Date): boolean {
  const week1 = getWeekNumber(date1);
  const week2 = getWeekNumber(date2);
  const year1 = date1.getFullYear();
  const year2 = date2.getFullYear();
  
  // Handle year boundary
  if (year2 === year1 + 1) {
    const lastWeekOfYear1 = getWeekNumber(new Date(year1, 11, 31));
    return week1 === lastWeekOfYear1 && week2 === 0;
  }
  
  return year1 === year2 && week2 === week1 + 1;
}

/**
 * Calculate discount percentage based on streak weeks
 */
export function calculateDiscountPercentage(
  streakWeeks: number,
  config: StreakConfig = DEFAULT_STREAK_CONFIG
): number {
  if (streakWeeks <= 0) return 0;
  
  const weeks = Math.min(streakWeeks, config.maxStreakWeeks);
  const discount = config.baseDiscountPercent + 
    ((weeks - 1) * config.discountIncrementPerWeek);
  
  return Math.min(discount, config.maxDiscountPercent);
}

/**
 * Get or create user streak record
 */
export async function getUserStreak(userId: number) {
  let streak = await prisma.userStreak.findUnique({
    where: { userId },
  });

  if (!streak) {
    streak = await prisma.userStreak.create({
      data: {
        userId,
        currentStreak: 0,
        longestStreak: 0,
        currentWeekCheckIns: 0,
        totalCheckIns: 0,
        currentDiscountPercent: 0,
        maxDiscountReached: false,
      },
    });
  }

  return streak;
}

/**
 * Update user streak after a check-in
 */
export async function updateStreakAfterCheckIn(
  userId: number,
  checkInDate: Date = new Date()
): Promise<{
  streak: any;
  streakUpdated: boolean;
  newWeek: boolean;
  streakBroken: boolean;
  discountPercent: number;
  message: string;
}> {
  const userStreak = await getUserStreak(userId);
  const now = checkInDate;
  
  let streakUpdated = false;
  let newWeek = false;
  let streakBroken = false;
  let currentStreak = userStreak.currentStreak;
  let currentWeekCheckIns = userStreak.currentWeekCheckIns;
  let totalCheckIns = userStreak.totalCheckIns + 1;
  let streakStartDate = userStreak.streakStartDate;
  let lastCheckInDate = now;

  // If this is the first check-in ever
  if (!userStreak.lastCheckInDate) {
    currentStreak = 1;
    currentWeekCheckIns = 1;
    streakStartDate = now;
    streakUpdated = true;
    newWeek = true;
  } else {
    const lastCheckIn = new Date(userStreak.lastCheckInDate);
    
    // Same week - just increment weekly count
    if (isSameWeek(lastCheckIn, now)) {
      currentWeekCheckIns += 1;
    }
    // Consecutive week - increment streak
    else if (isConsecutiveWeek(lastCheckIn, now)) {
      currentStreak += 1;
      currentWeekCheckIns = 1;
      streakUpdated = true;
      newWeek = true;
    }
    // Streak broken - reset
    else {
      currentStreak = 1;
      currentWeekCheckIns = 1;
      streakStartDate = now;
      streakUpdated = true;
      streakBroken = true;
      newWeek = true;
    }
  }

  const longestStreak = Math.max(userStreak.longestStreak, currentStreak);
  const discountPercent = calculateDiscountPercentage(currentStreak);
  const maxDiscountReached = discountPercent >= DEFAULT_STREAK_CONFIG.maxDiscountPercent;

  const updatedStreak = await prisma.userStreak.update({
    where: { userId },
    data: {
      currentStreak,
      longestStreak,
      lastCheckInDate,
      currentWeekCheckIns,
      totalCheckIns,
      streakStartDate,
      currentDiscountPercent: discountPercent,
      maxDiscountReached,
    },
  });

  let message = '';
  if (streakBroken) {
    message = 'Streak broken! Starting fresh with 10% discount.';
  } else if (newWeek) {
    message = `${currentStreak} week streak! You've earned ${discountPercent}% off on your next order/pickup!`;
  } else {
    message = `Check-in recorded! Current discount: ${discountPercent}%`;
  }

  if (maxDiscountReached && newWeek) {
    message += ' 🎉 Maximum discount reached!';
  }

  return {
    streak: updatedStreak,
    streakUpdated,
    newWeek,
    streakBroken,
    discountPercent,
    message,
  };
}

/**
 * Get user streak information for display
 */
export async function getStreakInfo(userId: number) {
  const streak = await getUserStreak(userId);
  const discountPercent = calculateDiscountPercentage(streak.currentStreak);
  const nextWeekDiscount = calculateDiscountPercentage(streak.currentStreak + 1);
  const weeksUntilMax = Math.max(
    0,
    DEFAULT_STREAK_CONFIG.maxStreakWeeks - streak.currentStreak
  );

  return {
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    lastCheckInDate: streak.lastCheckInDate,
    currentWeekCheckIns: streak.currentWeekCheckIns,
    totalCheckIns: streak.totalCheckIns,
    streakStartDate: streak.streakStartDate,
    currentDiscountPercent: discountPercent,
    nextWeekDiscountPercent: nextWeekDiscount,
    maxDiscountReached: streak.maxDiscountReached,
    weeksUntilMaxDiscount: weeksUntilMax,
    maxPossibleDiscount: DEFAULT_STREAK_CONFIG.maxDiscountPercent,
  };
}

/**
 * Reset all user streaks (admin function, use with caution)
 */
export async function resetAllStreaks() {
  return await prisma.userStreak.updateMany({
    data: {
      currentStreak: 0,
      currentWeekCheckIns: 0,
      currentDiscountPercent: 0,
      maxDiscountReached: false,
    },
  });
}

/**
 * Get streak leaderboard
 */
export async function getStreakLeaderboard(limit: number = 10) {
  return await prisma.userStreak.findMany({
    take: limit,
    orderBy: [
      { currentStreak: 'desc' },
      { longestStreak: 'desc' },
    ],
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });
}

/**
 * Apply discount to order amount
 */
export function applyStreakDiscount(
  orderAmount: number,
  discountPercent: number
): {
  originalAmount: number;
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
} {
  const discountAmount = (orderAmount * discountPercent) / 100;
  const finalAmount = orderAmount - discountAmount;

  return {
    originalAmount: orderAmount,
    discountPercent,
    discountAmount: Math.round(discountAmount * 100) / 100,
    finalAmount: Math.round(finalAmount * 100) / 100,
  };
}
