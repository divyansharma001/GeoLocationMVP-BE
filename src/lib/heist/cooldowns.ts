/**
 * Heist Cooldown Management
 * 
 * Functions for checking and managing cooldown periods.
 */

import { PrismaClient, HeistStatus } from '@prisma/client';
import { getHeistConfig, hoursToMs } from './config';

const prisma = new PrismaClient();

/**
 * Get the last successful heist performed by a user (as attacker)
 */
export async function getLastAttackerHeist(userId: number): Promise<Date | null> {
  const lastHeist = await prisma.heist.findFirst({
    where: {
      attackerId: userId,
      status: HeistStatus.SUCCESS,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      createdAt: true,
    },
  });

  return lastHeist?.createdAt || null;
}

/**
 * Get the last time a user was robbed (as victim)
 */
export async function getLastVictimHeist(userId: number): Promise<Date | null> {
  const lastHeist = await prisma.heist.findFirst({
    where: {
      victimId: userId,
      status: HeistStatus.SUCCESS,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      createdAt: true,
    },
  });

  return lastHeist?.createdAt || null;
}

/**
 * Check if attacker is on cooldown
 * Returns time remaining in milliseconds, or 0 if not on cooldown
 */
export async function checkAttackerCooldown(userId: number): Promise<{
  onCooldown: boolean;
  timeRemainingMs: number;
  canHeistAt: Date | null;
}> {
  const config = getHeistConfig();
  const lastHeistDate = await getLastAttackerHeist(userId);

  if (!lastHeistDate) {
    return {
      onCooldown: false,
      timeRemainingMs: 0,
      canHeistAt: null,
    };
  }

  const cooldownMs = hoursToMs(config.attackerCooldown);
  const elapsedMs = Date.now() - lastHeistDate.getTime();
  const remainingMs = cooldownMs - elapsedMs;

  if (remainingMs <= 0) {
    return {
      onCooldown: false,
      timeRemainingMs: 0,
      canHeistAt: null,
    };
  }

  return {
    onCooldown: true,
    timeRemainingMs: remainingMs,
    canHeistAt: new Date(Date.now() + remainingMs),
  };
}

/**
 * Check if victim is protected (was recently robbed)
 * Returns time remaining in milliseconds, or 0 if not protected
 */
export async function checkVictimProtection(userId: number): Promise<{
  isProtected: boolean;
  timeRemainingMs: number;
  vulnerableAt: Date | null;
}> {
  const config = getHeistConfig();
  const lastHeistDate = await getLastVictimHeist(userId);

  if (!lastHeistDate) {
    return {
      isProtected: false,
      timeRemainingMs: 0,
      vulnerableAt: null,
    };
  }

  const protectionMs = hoursToMs(config.victimProtection);
  const elapsedMs = Date.now() - lastHeistDate.getTime();
  const remainingMs = protectionMs - elapsedMs;

  if (remainingMs <= 0) {
    return {
      isProtected: false,
      timeRemainingMs: 0,
      vulnerableAt: null,
    };
  }

  return {
    isProtected: true,
    timeRemainingMs: remainingMs,
    vulnerableAt: new Date(Date.now() + remainingMs),
  };
}

/**
 * Get comprehensive cooldown info for a user
 */
export async function getCooldownInfo(userId: number): Promise<{
  attacker: Awaited<ReturnType<typeof checkAttackerCooldown>>;
  victim: Awaited<ReturnType<typeof checkVictimProtection>>;
}> {
  const [attacker, victim] = await Promise.all([
    checkAttackerCooldown(userId),
    checkVictimProtection(userId),
  ]);

  return { attacker, victim };
}

/**
 * Get heists performed by user today (for rate limiting)
 */
export async function getHeistsToday(userId: number): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const count = await prisma.heist.count({
    where: {
      attackerId: userId,
      status: HeistStatus.SUCCESS,
      createdAt: {
        gte: startOfDay,
      },
    },
  });

  return count;
}

/**
 * Check if user has exceeded daily heist limit
 */
export async function hasExceededDailyLimit(userId: number): Promise<boolean> {
  const config = getHeistConfig();
  const heistsToday = await getHeistsToday(userId);
  return heistsToday >= config.maxHeistsPerDay;
}
