/**
 * Heist Validation Logic
 * 
 * Functions for validating heist eligibility before execution.
 */

import { PrismaClient } from '@prisma/client';
import { getHeistConfig, calculatePointsToSteal } from './config';
import { hasTokens } from './tokens';
import { checkAttackerCooldown, checkVictimProtection, hasExceededDailyLimit } from './cooldowns';

const prisma = new PrismaClient();

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  code?: string;
  details?: any;
}

/**
 * Check if feature is enabled
 */
export function checkFeatureEnabled(): EligibilityResult {
  const config = getHeistConfig();
  
  if (!config.enabled) {
    return {
      eligible: false,
      reason: 'Heist feature is currently disabled',
      code: 'FEATURE_DISABLED',
    };
  }

  return { eligible: true };
}

/**
 * Check if attacker has sufficient tokens
 */
export async function checkSufficientTokens(attackerId: number): Promise<EligibilityResult> {
  const config = getHeistConfig();
  const hasEnough = await hasTokens(attackerId, config.tokenCost);

  if (!hasEnough) {
    return {
      eligible: false,
      reason: 'You do not have enough heist tokens',
      code: 'INSUFFICIENT_TOKENS',
      details: { required: config.tokenCost },
    };
  }

  return { eligible: true };
}

/**
 * Check if attacker is on cooldown
 */
export async function checkAttackerNotOnCooldown(attackerId: number): Promise<EligibilityResult> {
  const cooldownInfo = await checkAttackerCooldown(attackerId);

  if (cooldownInfo.onCooldown) {
    return {
      eligible: false,
      reason: 'You are on cooldown. Please wait before your next heist.',
      code: 'COOLDOWN_ACTIVE',
      details: {
        timeRemainingMs: cooldownInfo.timeRemainingMs,
        canHeistAt: cooldownInfo.canHeistAt,
      },
    };
  }

  return { eligible: true };
}

/**
 * Check if victim is not protected
 */
export async function checkVictimNotProtected(victimId: number): Promise<EligibilityResult> {
  const protectionInfo = await checkVictimProtection(victimId);

  if (protectionInfo.isProtected) {
    return {
      eligible: false,
      reason: 'This user was recently robbed and is protected',
      code: 'TARGET_PROTECTED',
      details: {
        timeRemainingMs: protectionInfo.timeRemainingMs,
        vulnerableAt: protectionInfo.vulnerableAt,
      },
    };
  }

  return { eligible: true };
}

/**
 * Check if attacker is not trying to rob themselves
 */
export function checkNotSelfTargeting(attackerId: number, victimId: number): EligibilityResult {
  if (attackerId === victimId) {
    return {
      eligible: false,
      reason: 'You cannot rob yourself',
      code: 'INVALID_TARGET',
    };
  }

  return { eligible: true };
}

/**
 * Check if victim exists and has sufficient points
 */
export async function checkVictimHasSufficientPoints(victimId: number): Promise<EligibilityResult> {
  const config = getHeistConfig();

  const victim = await prisma.user.findUnique({
    where: { id: victimId },
    select: { id: true, monthlyPoints: true },
  });

  if (!victim) {
    return {
      eligible: false,
      reason: 'Target user not found',
      code: 'INVALID_TARGET',
    };
  }

  if (victim.monthlyPoints < config.minVictimPoints) {
    return {
      eligible: false,
      reason: `Target must have at least ${config.minVictimPoints} points to be robbed`,
      code: 'INSUFFICIENT_VICTIM_POINTS',
      details: {
        required: config.minVictimPoints,
        actual: victim.monthlyPoints,
      },
    };
  }

  return { eligible: true };
}

/**
 * Check if attacker has not exceeded daily heist limit
 */
export async function checkDailyLimit(attackerId: number): Promise<EligibilityResult> {
  const exceeded = await hasExceededDailyLimit(attackerId);

  if (exceeded) {
    const config = getHeistConfig();
    return {
      eligible: false,
      reason: `You have reached the daily heist limit of ${config.maxHeistsPerDay}`,
      code: 'DAILY_LIMIT_EXCEEDED',
      details: { limit: config.maxHeistsPerDay },
    };
  }

  return { eligible: true };
}

/**
 * Run all eligibility checks
 * Returns the first failing check, or { eligible: true } if all pass
 */
export async function checkHeistEligibility(
  attackerId: number,
  victimId: number
): Promise<EligibilityResult> {
  // 1. Feature enabled check
  const featureCheck = checkFeatureEnabled();
  if (!featureCheck.eligible) return featureCheck;

  // 2. Not self-targeting
  const selfCheck = checkNotSelfTargeting(attackerId, victimId);
  if (!selfCheck.eligible) return selfCheck;

  // 3. Victim exists and has enough points
  const victimPointsCheck = await checkVictimHasSufficientPoints(victimId);
  if (!victimPointsCheck.eligible) return victimPointsCheck;

  // 4. Attacker has tokens
  const tokensCheck = await checkSufficientTokens(attackerId);
  if (!tokensCheck.eligible) return tokensCheck;

  // 5. Attacker not on cooldown
  const cooldownCheck = await checkAttackerNotOnCooldown(attackerId);
  if (!cooldownCheck.eligible) return cooldownCheck;

  // 6. Victim not protected
  const protectionCheck = await checkVictimNotProtected(victimId);
  if (!protectionCheck.eligible) return protectionCheck;

  // 7. Daily limit not exceeded
  const dailyLimitCheck = await checkDailyLimit(attackerId);
  if (!dailyLimitCheck.eligible) return dailyLimitCheck;

  // All checks passed
  return { eligible: true };
}

/**
 * Get detailed eligibility breakdown for display
 * (Useful for /can-rob endpoint)
 */
export async function getEligibilityBreakdown(
  attackerId: number,
  victimId: number
): Promise<{
  eligible: boolean;
  checks: {
    featureEnabled: boolean;
    notSelfTargeting: boolean;
    victimHasPoints: boolean;
    hasTokens: boolean;
    notOnCooldown: boolean;
    victimNotProtected: boolean;
    withinDailyLimit: boolean;
  };
  failureReason?: EligibilityResult;
  pointsWouldSteal?: number;
}> {
  const config = getHeistConfig();

  // Run all checks
  const [
    featureCheck,
    selfCheck,
    victimPointsCheck,
    tokensCheck,
    cooldownCheck,
    protectionCheck,
    dailyLimitCheck,
  ] = await Promise.all([
    Promise.resolve(checkFeatureEnabled()),
    Promise.resolve(checkNotSelfTargeting(attackerId, victimId)),
    checkVictimHasSufficientPoints(victimId),
    checkSufficientTokens(attackerId),
    checkAttackerNotOnCooldown(attackerId),
    checkVictimNotProtected(victimId),
    checkDailyLimit(attackerId),
  ]);

  const checks = {
    featureEnabled: featureCheck.eligible,
    notSelfTargeting: selfCheck.eligible,
    victimHasPoints: victimPointsCheck.eligible,
    hasTokens: tokensCheck.eligible,
    notOnCooldown: cooldownCheck.eligible,
    victimNotProtected: protectionCheck.eligible,
    withinDailyLimit: dailyLimitCheck.eligible,
  };

  const allPassed = Object.values(checks).every((check) => check);

  // Find first failure
  const firstFailure =
    !featureCheck.eligible ? featureCheck :
    !selfCheck.eligible ? selfCheck :
    !victimPointsCheck.eligible ? victimPointsCheck :
    !tokensCheck.eligible ? tokensCheck :
    !cooldownCheck.eligible ? cooldownCheck :
    !protectionCheck.eligible ? protectionCheck :
    !dailyLimitCheck.eligible ? dailyLimitCheck :
    undefined;

  // Calculate points if eligible
  let pointsWouldSteal: number | undefined;
  if (allPassed) {
    const victim = await prisma.user.findUnique({
      where: { id: victimId },
      select: { monthlyPoints: true },
    });
    if (victim) {
      pointsWouldSteal = calculatePointsToSteal(victim.monthlyPoints, config);
    }
  }

  return {
    eligible: allPassed,
    checks,
    failureReason: firstFailure,
    pointsWouldSteal,
  };
}
