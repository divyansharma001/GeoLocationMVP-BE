import { Response, NextFunction } from 'express';
import { VerificationStepType } from '@prisma/client';
import { AuthRequest } from './auth.middleware';
import prisma from '../lib/prisma';
import redis from '../lib/redis';

const REQUIRED_VERIFICATION_STEPS: VerificationStepType[] = [
  VerificationStepType.IDENTITY,
  VerificationStepType.BUSINESS_LICENSE,
  VerificationStepType.ADDRESS_PROOF,
];

/**
 * Middleware: Prevents merchants from creating/activating venue rewards
 * until their business verification is complete.
 * Must be used AFTER protect + isApprovedMerchant.
 */
export const requireMerchantVerified = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) {
      return res.status(403).json({ error: 'Merchant profile required' });
    }

    // Check Redis cache first
    const cacheKey = `merchant_verified:${merchantId}`;
    const cached = await redis.get(cacheKey);

    if (cached === 'true') {
      return next();
    }
    if (cached === 'false') {
      return res.status(403).json({
        error: 'Business verification is not complete. Please complete all verification steps before creating rewards.',
        verificationRequired: true,
      });
    }

    // Cache miss: query DB
    const approvedSteps = await prisma.merchantVerification.count({
      where: {
        merchantId,
        stepType: { in: REQUIRED_VERIFICATION_STEPS },
        status: 'APPROVED',
      },
    });

    const isVerified = approvedSteps >= REQUIRED_VERIFICATION_STEPS.length;

    // Cache for 5 minutes
    await redis.set(cacheKey, isVerified ? 'true' : 'false', 'EX', 300);

    if (!isVerified) {
      return res.status(403).json({
        error: 'Business verification is not complete. Please complete all verification steps before creating rewards.',
        verificationRequired: true,
        approvedSteps,
        requiredSteps: REQUIRED_VERIFICATION_STEPS.length,
      });
    }

    next();
  } catch (error) {
    console.error('Verification check error:', error);
    res.status(500).json({ error: 'Failed to verify business status' });
  }
};

/**
 * Middleware: Prevents double-claims and enforces cooldown period for venue rewards.
 * Uses Redis SET NX EX for distributed locking.
 * Expects venueRewardId in req.params.
 */
export const claimCooldownLock = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const venueRewardId = parseInt(req.params.venueRewardId as string);
    if (!venueRewardId || isNaN(venueRewardId)) {
      return res.status(400).json({ error: 'Valid venue reward ID required' });
    }

    // Acquire distributed lock to prevent concurrent double-claims
    const lockKey = `claim_lock:${userId}:${venueRewardId}`;
    const lockAcquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');

    if (!lockAcquired) {
      return res.status(429).json({
        error: 'Claim already in progress. Please wait.',
        retryAfter: 30,
      });
    }

    // Check cooldown from Redis cache
    const cooldownCacheKey = `claim_cooldown:${userId}:${venueRewardId}`;
    const inCooldown = await redis.get(cooldownCacheKey);

    if (inCooldown) {
      const remainingTTL = await redis.ttl(cooldownCacheKey);
      await redis.del(lockKey);
      return res.status(429).json({
        error: 'Cooldown period active. You cannot claim this reward yet.',
        cooldownRemainingSeconds: remainingTTL > 0 ? remainingTTL : 0,
      });
    }

    // Attach lock keys to request for cleanup in route handler
    (req as any).claimLockKey = lockKey;
    (req as any).cooldownCacheKey = cooldownCacheKey;

    next();
  } catch (error) {
    console.error('Claim cooldown lock error:', error);
    const userId = req.user?.id;
    const venueRewardId = req.params.venueRewardId;
    if (userId && venueRewardId) {
      await redis.del(`claim_lock:${userId}:${venueRewardId}`).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to process claim request' });
  }
};

/**
 * Release the distributed claim lock and set cooldown after successful claim.
 */
export async function releaseClaimLockAndSetCooldown(req: AuthRequest, cooldownHours: number): Promise<void> {
  const lockKey = (req as any).claimLockKey;
  const cooldownCacheKey = (req as any).cooldownCacheKey;

  if (lockKey) {
    await redis.del(lockKey).catch(() => {});
  }

  if (cooldownCacheKey && cooldownHours > 0) {
    await redis.set(cooldownCacheKey, '1', 'EX', cooldownHours * 3600).catch(() => {});
  }
}

/**
 * Release the distributed claim lock WITHOUT setting cooldown (for failed claims).
 */
export async function releaseClaimLock(req: AuthRequest): Promise<void> {
  const lockKey = (req as any).claimLockKey;
  if (lockKey) {
    await redis.del(lockKey).catch(() => {});
  }
}
