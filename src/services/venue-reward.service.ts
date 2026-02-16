import prisma from '../lib/prisma';
import { CoinTransactionType, Prisma, VerificationStepType } from '@prisma/client';
import { awardCoinsInTransaction } from '../lib/gamification';
import { haversineMeters } from '../lib/geo';
import { getIO } from '../lib/websocket/socket.server';
import redis from '../lib/redis';
import { verifyVenueRewardQRData } from '../lib/venue-reward-qr.service';
import {
  sendVerificationSubmittedEmail,
  sendVerificationReviewedEmail,
  sendVerificationCompleteEmail,
} from '../lib/email';
import { trackInterest } from '../lib/interest-tracking';

const REQUIRED_VERIFICATION_STEPS: VerificationStepType[] = [
  VerificationStepType.IDENTITY,
  VerificationStepType.BUSINESS_LICENSE,
  VerificationStepType.ADDRESS_PROOF,
];

// ── Venue Reward CRUD ──

export async function createVenueReward(params: {
  merchantId: number;
  storeId?: number;
  title: string;
  description?: string;
  rewardType: 'COINS' | 'DISCOUNT_PERCENTAGE' | 'DISCOUNT_FIXED' | 'BONUS_POINTS' | 'FREE_ITEM';
  rewardAmount: number;
  geoFenceRadiusMeters?: number;
  latitude?: number;
  longitude?: number;
  startDate: Date;
  endDate: Date;
  maxTotalClaims?: number;
  maxClaimsPerUser?: number;
  cooldownHours?: number;
  requiresCheckIn?: boolean;
  imageUrl?: string;
}) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: params.merchantId },
    select: { id: true, status: true, businessName: true, latitude: true, longitude: true },
  });

  if (!merchant) throw new Error('Merchant not found');
  if (merchant.status !== 'APPROVED') throw new Error('Merchant is not approved');

  // Verify merchant has completed verification
  const verified = await isMerchantVerified(params.merchantId);
  if (!verified) throw new Error('Merchant verification is not complete');

  if (params.endDate <= params.startDate) throw new Error('endDate must be after startDate');
  if (params.rewardAmount <= 0) throw new Error('rewardAmount must be positive');

  // Resolve coordinates
  let lat = params.latitude;
  let lon = params.longitude;

  if (params.storeId) {
    const store = await prisma.store.findUnique({
      where: { id: params.storeId },
      select: { id: true, merchantId: true, latitude: true, longitude: true },
    });
    if (!store) throw new Error('Store not found');
    if (store.merchantId !== params.merchantId) throw new Error('Store does not belong to this merchant');
    if (!lat || !lon) {
      lat = store.latitude ?? undefined;
      lon = store.longitude ?? undefined;
    }
  }

  if (!lat || !lon) {
    lat = merchant.latitude ?? undefined;
    lon = merchant.longitude ?? undefined;
  }

  if (!lat || !lon) throw new Error('No coordinates available. Set location on the reward, store, or merchant.');

  const reward = await prisma.venueReward.create({
    data: {
      merchantId: params.merchantId,
      storeId: params.storeId ?? null,
      title: params.title,
      description: params.description,
      rewardType: params.rewardType,
      rewardAmount: params.rewardAmount,
      geoFenceRadiusMeters: params.geoFenceRadiusMeters ?? 100,
      latitude: lat,
      longitude: lon,
      status: 'DRAFT',
      startDate: params.startDate,
      endDate: params.endDate,
      maxTotalClaims: params.maxTotalClaims ?? null,
      maxClaimsPerUser: params.maxClaimsPerUser ?? 1,
      cooldownHours: params.cooldownHours ?? 24,
      requiresCheckIn: params.requiresCheckIn ?? true,
      imageUrl: params.imageUrl,
    },
    include: { merchant: { select: { id: true, businessName: true } } },
  });

  return reward;
}

export async function claimVenueReward(params: {
  userId: number;
  venueRewardId: number;
  latitude: number;
  longitude: number;
  verificationMethod?: 'GPS' | 'QR_CODE';
  qrData?: string;
}) {
  const reward = await prisma.venueReward.findUnique({
    where: { id: params.venueRewardId },
    include: {
      merchant: { select: { id: true, latitude: true, longitude: true, status: true, ownerId: true, businessName: true } },
      store: { select: { id: true, latitude: true, longitude: true } },
    },
  });

  if (!reward) throw new Error('Venue reward not found');
  if (reward.status !== 'ACTIVE') throw new Error('Venue reward is not active');

  const now = new Date();
  if (now < reward.startDate || now > reward.endDate) throw new Error('Venue reward is not currently available');
  if (reward.maxTotalClaims !== null && reward.currentClaims >= reward.maxTotalClaims) {
    throw new Error('This venue reward has reached its maximum claims');
  }

  // Resolve venue coordinates
  const venueLat = reward.latitude ?? reward.store?.latitude ?? reward.merchant.latitude;
  const venueLon = reward.longitude ?? reward.store?.longitude ?? reward.merchant.longitude;
  if (venueLat == null || venueLon == null) throw new Error('Venue location not available');

  // Geo-fence check
  const distanceMeters = haversineMeters(params.latitude, params.longitude, venueLat, venueLon);
  if (distanceMeters > reward.geoFenceRadiusMeters) {
    throw new Error(
      `You are outside the geo-fence. Distance: ${Math.round(distanceMeters)}m, required: ${reward.geoFenceRadiusMeters}m`
    );
  }

  // QR code validation (when verificationMethod is QR_CODE)
  if (params.verificationMethod === 'QR_CODE') {
    if (!params.qrData) {
      throw new Error('QR code data is required for QR_CODE verification');
    }
    const qrPayload = verifyVenueRewardQRData(params.qrData);
    if (!qrPayload) {
      throw new Error('Invalid or expired QR code');
    }
    if (qrPayload.venueRewardId !== params.venueRewardId) {
      throw new Error('QR code does not match this reward');
    }
  }

  // Check requires check-in
  if (reward.requiresCheckIn) {
    const recentCheckIn = await prisma.checkIn.findFirst({
      where: {
        userId: params.userId,
        merchantId: reward.merchantId,
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (!recentCheckIn) throw new Error('You must check in at this venue before claiming the reward');
  }

  // Cooldown check
  const cooldownThreshold = new Date(now.getTime() - reward.cooldownHours * 60 * 60 * 1000);
  const recentClaim = await prisma.venueRewardClaim.findFirst({
    where: {
      userId: params.userId,
      venueRewardId: params.venueRewardId,
      createdAt: { gte: cooldownThreshold },
    },
    select: { id: true, createdAt: true },
  });
  if (recentClaim) {
    const remainingMs = recentClaim.createdAt.getTime() + reward.cooldownHours * 3600000 - now.getTime();
    throw new Error(`Cooldown active. Try again in ${Math.ceil(remainingMs / 60000)} minutes`);
  }

  // Per-user limit check
  const userClaimCount = await prisma.venueRewardClaim.count({
    where: { userId: params.userId, venueRewardId: params.venueRewardId },
  });
  if (userClaimCount >= reward.maxClaimsPerUser) {
    throw new Error('You have reached the maximum claims for this reward');
  }

  // Atomic claim transaction
  const result = await prisma.$transaction(async (tx) => {
    // Re-verify counts inside transaction
    const currentReward = await tx.venueReward.findUnique({
      where: { id: params.venueRewardId },
      select: { currentClaims: true, maxTotalClaims: true },
    });
    if (currentReward?.maxTotalClaims !== null && (currentReward?.currentClaims ?? 0) >= (currentReward?.maxTotalClaims ?? 0)) {
      throw new Error('This venue reward has reached its maximum claims');
    }

    let coinsAwarded = 0;
    let balanceAfter = 0;

    if (reward.rewardType === 'COINS') {
      const coinResult = await awardCoinsInTransaction(
        tx,
        params.userId,
        Math.floor(reward.rewardAmount),
        CoinTransactionType.EARNED,
        `Venue reward claimed: ${reward.title}`,
        { venueRewardId: reward.id, distanceMeters: Math.round(distanceMeters * 100) / 100 }
      );
      coinsAwarded = coinResult.transaction.amount;
      balanceAfter = coinResult.balanceAfter;
    }

    const claim = await tx.venueRewardClaim.create({
      data: {
        venueRewardId: params.venueRewardId,
        userId: params.userId,
        claimLatitude: params.latitude,
        claimLongitude: params.longitude,
        distanceMeters: Math.round(distanceMeters * 100) / 100,
        verificationMethod: params.verificationMethod ?? 'GPS',
        coinsAwarded,
        pointsAwarded: 0,
        rewardValue: reward.rewardAmount,
        metadata: { rewardType: reward.rewardType, merchantName: reward.merchant.businessName },
      },
    });

    await tx.venueReward.update({
      where: { id: params.venueRewardId },
      data: { currentClaims: { increment: 1 } },
    });

    return { claim, coinsAwarded, balanceAfter };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // WebSocket notification
  try {
    getIO().to(`user:${params.userId}`).emit('venue_reward:claimed', {
      venueRewardId: reward.id,
      title: reward.title,
      rewardType: reward.rewardType,
      rewardAmount: reward.rewardAmount,
      coinsAwarded: result.coinsAwarded,
    });
  } catch (_) { /* WebSocket not critical */ }

  // Track interest (fire-and-forget)
  trackInterest({
    merchantId: reward.merchantId,
    userId: params.userId,
    eventType: 'REWARD_CLAIM',
    venueRewardId: reward.id,
  });

  return {
    claim: result.claim,
    coinsAwarded: result.coinsAwarded,
    balanceAfter: result.balanceAfter,
    distanceMeters: Math.round(distanceMeters * 100) / 100,
    cooldownHours: reward.cooldownHours,
  };
}

export async function getAvailableVenueRewards(params: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  page?: number;
  limit?: number;
  userId?: number;
}) {
  const searchRadius = params.radiusMeters ?? 5000;
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const now = new Date();

  const rewards = await prisma.venueReward.findMany({
    where: {
      status: 'ACTIVE',
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: {
      merchant: { select: { id: true, businessName: true, logoUrl: true, latitude: true, longitude: true } },
      store: { select: { id: true, address: true, latitude: true, longitude: true } },
      _count: { select: { claims: true } },
    },
  });

  // Calculate distances and filter
  const withDistance = rewards
    .map((reward) => {
      const lat = reward.latitude ?? reward.store?.latitude ?? reward.merchant.latitude;
      const lon = reward.longitude ?? reward.store?.longitude ?? reward.merchant.longitude;
      if (lat == null || lon == null) return null;
      const distance = haversineMeters(params.latitude, params.longitude, lat, lon);
      return { ...reward, distanceMeters: Math.round(distance) };
    })
    .filter((r): r is NonNullable<typeof r> =>
      r !== null &&
      r.distanceMeters <= searchRadius &&
      (r.maxTotalClaims === null || r.currentClaims < r.maxTotalClaims)
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const total = withDistance.length;
  const paginated = withDistance.slice((page - 1) * limit, page * limit);

  // If userId provided, check user's claim status for each reward
  let enriched = paginated;
  if (params.userId) {
    const rewardIds = paginated.map((r) => r.id);
    const userClaims = await prisma.venueRewardClaim.findMany({
      where: { userId: params.userId, venueRewardId: { in: rewardIds } },
      select: { venueRewardId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const claimMap = new Map<number, { count: number; lastClaimedAt: Date }>();
    for (const claim of userClaims) {
      const existing = claimMap.get(claim.venueRewardId);
      if (existing) {
        existing.count++;
      } else {
        claimMap.set(claim.venueRewardId, { count: 1, lastClaimedAt: claim.createdAt });
      }
    }

    enriched = paginated.map((r) => {
      const claimInfo = claimMap.get(r.id);
      return {
        ...r,
        userClaimCount: claimInfo?.count ?? 0,
        lastClaimedAt: claimInfo?.lastClaimedAt ?? null,
        canClaim: !claimInfo || (
          claimInfo.count < r.maxClaimsPerUser &&
          (new Date().getTime() - claimInfo.lastClaimedAt.getTime()) > r.cooldownHours * 3600000
        ),
      };
    });
  }

  return {
    rewards: enriched,
    pagination: { page, limit, total, hasMore: page * limit < total },
  };
}

export async function getMerchantVenueRewards(params: {
  merchantId: number;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;

  const where: any = { merchantId: params.merchantId };
  if (params.status) {
    where.status = params.status;
  }

  const [rewards, total, stats] = await Promise.all([
    prisma.venueReward.findMany({
      where,
      include: {
        store: { select: { id: true, address: true } },
        _count: { select: { claims: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.venueReward.count({ where }),
    prisma.venueReward.aggregate({
      where: { merchantId: params.merchantId },
      _count: true,
    }),
  ]);

  const activeCount = await prisma.venueReward.count({
    where: { merchantId: params.merchantId, status: 'ACTIVE' },
  });
  const totalClaims = await prisma.venueRewardClaim.count({
    where: { venueReward: { merchantId: params.merchantId } },
  });

  return {
    rewards,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
    stats: { totalRewards: stats._count, activeRewards: activeCount, totalClaims },
  };
}

export async function getVenueRewardById(venueRewardId: number, requestingUserId?: number) {
  const reward = await prisma.venueReward.findUnique({
    where: { id: venueRewardId },
    include: {
      merchant: { select: { id: true, businessName: true, logoUrl: true, latitude: true, longitude: true } },
      store: { select: { id: true, address: true, latitude: true, longitude: true } },
      _count: { select: { claims: true } },
    },
  });

  if (!reward) throw new Error('Venue reward not found');

  if (requestingUserId) {
    const userClaims = await prisma.venueRewardClaim.findMany({
      where: { userId: requestingUserId, venueRewardId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const lastClaimedAt = userClaims[0]?.createdAt ?? null;
    const userClaimCount = userClaims.length;
    const canClaim = userClaimCount < reward.maxClaimsPerUser &&
      (!lastClaimedAt || (Date.now() - lastClaimedAt.getTime()) > reward.cooldownHours * 3600000);
    return { ...reward, userClaimCount, lastClaimedAt, canClaim };
  }

  return reward;
}

export async function updateVenueReward(params: {
  venueRewardId: number;
  merchantId: number;
  title?: string;
  description?: string;
  rewardType?: 'COINS' | 'DISCOUNT_PERCENTAGE' | 'DISCOUNT_FIXED' | 'BONUS_POINTS' | 'FREE_ITEM';
  rewardAmount?: number;
  geoFenceRadiusMeters?: number;
  latitude?: number;
  longitude?: number;
  startDate?: Date;
  endDate?: Date;
  maxTotalClaims?: number | null;
  maxClaimsPerUser?: number;
  cooldownHours?: number;
  requiresCheckIn?: boolean;
  imageUrl?: string;
}) {
  const reward = await prisma.venueReward.findUnique({ where: { id: params.venueRewardId } });
  if (!reward) throw new Error('Venue reward not found');
  if (reward.merchantId !== params.merchantId) throw new Error('Venue reward not found');
  if (reward.status !== 'DRAFT' && reward.status !== 'PAUSED') {
    throw new Error('Cannot edit an active or expired reward. Pause it first.');
  }

  if (params.rewardAmount !== undefined && params.rewardAmount <= 0) {
    throw new Error('rewardAmount must be positive');
  }
  if (params.startDate && params.endDate && params.endDate <= params.startDate) {
    throw new Error('endDate must be after startDate');
  }

  const { venueRewardId, merchantId, ...updateFields } = params;
  const data: any = {};
  for (const [key, value] of Object.entries(updateFields)) {
    if (value !== undefined) data[key] = value;
  }

  return prisma.venueReward.update({
    where: { id: venueRewardId },
    data,
    include: { merchant: { select: { id: true, businessName: true } } },
  });
}

export async function deleteVenueReward(venueRewardId: number, merchantId: number) {
  const reward = await prisma.venueReward.findUnique({
    where: { id: venueRewardId },
    select: { id: true, merchantId: true, currentClaims: true },
  });
  if (!reward) throw new Error('Venue reward not found');
  if (reward.merchantId !== merchantId) throw new Error('Venue reward not found');

  if (reward.currentClaims > 0) {
    await prisma.venueReward.update({
      where: { id: venueRewardId },
      data: { status: 'EXPIRED' },
    });
    return { deleted: true, soft: true };
  }

  await prisma.venueReward.delete({ where: { id: venueRewardId } });
  return { deleted: true, soft: false };
}

export async function activateVenueReward(venueRewardId: number, merchantId: number) {
  const reward = await prisma.venueReward.findUnique({ where: { id: venueRewardId } });
  if (!reward) throw new Error('Venue reward not found');
  if (reward.merchantId !== merchantId) throw new Error('Venue reward not found');
  if (reward.status !== 'DRAFT' && reward.status !== 'PAUSED') {
    throw new Error(`Cannot activate reward with status ${reward.status}`);
  }

  const verified = await isMerchantVerified(merchantId);
  if (!verified) throw new Error('Merchant verification is not complete');

  if (!reward.latitude || !reward.longitude) {
    throw new Error('Venue reward must have coordinates before activation');
  }

  return prisma.venueReward.update({
    where: { id: venueRewardId },
    data: { status: 'ACTIVE' },
  });
}

export async function deactivateVenueReward(venueRewardId: number, merchantId: number) {
  const reward = await prisma.venueReward.findUnique({ where: { id: venueRewardId } });
  if (!reward) throw new Error('Venue reward not found');
  if (reward.merchantId !== merchantId) throw new Error('Venue reward not found');
  if (reward.status !== 'ACTIVE') throw new Error(`Cannot deactivate reward with status ${reward.status}`);

  return prisma.venueReward.update({
    where: { id: venueRewardId },
    data: { status: 'PAUSED' },
  });
}

// ── Verification Workflow ──

export async function submitVerificationStep(params: {
  merchantId: number;
  stepType: string;
  documentUrl: string;
  documentType?: string;
}) {
  const validSteps = Object.values(VerificationStepType);
  if (!validSteps.includes(params.stepType as VerificationStepType)) {
    throw new Error(`Invalid step type. Must be one of: ${validSteps.join(', ')}`);
  }

  const stepType = params.stepType as VerificationStepType;

  const verification = await prisma.merchantVerification.upsert({
    where: {
      merchantId_stepType: {
        merchantId: params.merchantId,
        stepType,
      },
    },
    update: {
      documentUrl: params.documentUrl,
      documentType: params.documentType,
      submittedAt: new Date(),
      status: 'DOCUMENTS_SUBMITTED',
      rejectionReason: null,
    },
    create: {
      merchantId: params.merchantId,
      stepType,
      documentUrl: params.documentUrl,
      documentType: params.documentType,
      submittedAt: new Date(),
      status: 'DOCUMENTS_SUBMITTED',
    },
  });

  // Invalidate verification cache
  await redis.del(`merchant_verified:${params.merchantId}`).catch(() => {});

  // Send confirmation email (fire-and-forget)
  try {
    const merchant = await prisma.merchant.findUnique({
      where: { id: params.merchantId },
      select: { businessName: true, owner: { select: { email: true } } },
    });
    if (merchant?.owner?.email) {
      sendVerificationSubmittedEmail({
        to: merchant.owner.email,
        merchantName: merchant.businessName,
        stepType: params.stepType,
      });
    }
  } catch (_) { /* email not critical */ }

  return verification;
}

export async function reviewVerificationStep(params: {
  verificationId: number;
  adminUserId: number;
  approved: boolean;
  rejectionReason?: string;
  notes?: string;
}) {
  const verification = await prisma.merchantVerification.findUnique({
    where: { id: params.verificationId },
    include: { merchant: { select: { id: true, ownerId: true, businessName: true, owner: { select: { email: true } } } } },
  });

  if (!verification) throw new Error('Verification step not found');

  const updated = await prisma.merchantVerification.update({
    where: { id: params.verificationId },
    data: {
      status: params.approved ? 'APPROVED' : 'REJECTED',
      reviewedAt: new Date(),
      reviewedBy: params.adminUserId,
      rejectionReason: params.approved ? null : params.rejectionReason,
      notes: params.notes,
    },
  });

  // Invalidate verification cache
  const merchantId = verification.merchantId;
  await redis.del(`merchant_verified:${merchantId}`).catch(() => {});

  // Check if fully verified and notify via WebSocket
  const isFullyVerified = await isMerchantVerified(merchantId);
  const merchantOwnerId = verification.merchant.ownerId;

  try {
    getIO().to(`user:${merchantOwnerId}`).emit('verification:step_reviewed', {
      merchantId,
      stepType: verification.stepType,
      status: params.approved ? 'APPROVED' : 'REJECTED',
      isFullyVerified,
    });

    if (isFullyVerified) {
      getIO().to(`user:${merchantOwnerId}`).emit('verification:completed', {
        merchantId,
        message: 'Your business is now fully verified! You can create and activate venue rewards.',
      });
    }
  } catch (_) { /* WebSocket not critical */ }

  // Send review email (fire-and-forget)
  try {
    const ownerEmail = verification.merchant.owner?.email;
    const merchantName = verification.merchant.businessName || 'Your business';
    if (ownerEmail) {
      sendVerificationReviewedEmail({
        to: ownerEmail,
        merchantName,
        stepType: verification.stepType,
        approved: params.approved,
        rejectionReason: params.rejectionReason,
      });
      if (isFullyVerified) {
        sendVerificationCompleteEmail({ to: ownerEmail, merchantName });
      }
    }
  } catch (_) { /* email not critical */ }

  return { ...updated, isFullyVerified };
}

export async function getMerchantVerificationStatus(merchantId: number) {
  const steps = await prisma.merchantVerification.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'asc' },
  });

  const approvedStepTypes = new Set(
    steps.filter((s) => s.status === 'APPROVED').map((s) => s.stepType)
  );

  const pendingSteps = REQUIRED_VERIFICATION_STEPS.filter(
    (step) => !approvedStepTypes.has(step)
  );

  return {
    steps,
    isFullyVerified: pendingSteps.length === 0,
    pendingSteps,
  };
}

export async function listPendingVerifications(params: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;

  const where: any = {};
  if (params.status) {
    where.status = params.status;
  } else {
    where.status = { in: ['DOCUMENTS_SUBMITTED', 'UNDER_REVIEW'] };
  }

  const [verifications, total] = await Promise.all([
    prisma.merchantVerification.findMany({
      where,
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            address: true,
            ownerId: true,
            owner: { select: { email: true, name: true } },
          },
        },
      },
      orderBy: { submittedAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.merchantVerification.count({ where }),
  ]);

  return {
    verifications,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function isMerchantVerified(merchantId: number): Promise<boolean> {
  // Check Redis cache first
  const cacheKey = `merchant_verified:${merchantId}`;
  const cached = await redis.get(cacheKey);
  if (cached === 'true') return true;
  if (cached === 'false') return false;

  const approvedCount = await prisma.merchantVerification.count({
    where: {
      merchantId,
      stepType: { in: REQUIRED_VERIFICATION_STEPS },
      status: 'APPROVED',
    },
  });

  const verified = approvedCount >= REQUIRED_VERIFICATION_STEPS.length;
  await redis.set(cacheKey, verified ? 'true' : 'false', 'EX', 300).catch(() => {});

  return verified;
}
