import prisma from '../lib/prisma';
import { CoinTransactionType } from '@prisma/client';
import { verifyBountyQRCode, generateBountyQRCode } from '../lib/dealUtils';
import { awardCoins } from '../lib/gamification';

/**
 * Start or get a user's bounty progress for a deal
 */
export async function startBountyProgress(userId: number, dealId: number) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { dealType: true, merchant: true },
  });

  if (!deal) {
    throw new Error('Deal not found');
  }

  if (deal.dealType.name !== 'Bounty Deal') {
    throw new Error('This deal is not a bounty deal');
  }

  if (!deal.bountyRewardAmount || !deal.minReferralsRequired) {
    throw new Error('Bounty deal is not properly configured');
  }

  const progress = await prisma.bountyProgress.upsert({
    where: { userId_dealId: { userId, dealId } },
    update: {},
    create: { userId, dealId },
  });

  return {
    progress,
    deal: {
      id: deal.id,
      title: deal.title,
      bountyRewardAmount: deal.bountyRewardAmount,
      minReferralsRequired: deal.minReferralsRequired,
      maxRedemptions: deal.maxRedemptions,
      currentRedemptions: deal.currentRedemptions,
      merchantName: deal.merchant.businessName,
    },
  };
}

/**
 * Record a referral for a bounty deal
 */
export async function recordBountyReferral(
  referrerId: number,
  referredUserId: number,
  dealId: number
) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { dealType: true },
  });

  if (!deal || deal.dealType.name !== 'Bounty Deal') {
    throw new Error('Invalid bounty deal');
  }

  if (referrerId === referredUserId) {
    throw new Error('Cannot refer yourself');
  }

  // Check max redemptions
  if (deal.maxRedemptions && deal.currentRedemptions >= deal.maxRedemptions) {
    throw new Error('This bounty deal has reached maximum redemptions');
  }

  const progress = await prisma.bountyProgress.upsert({
    where: { userId_dealId: { userId: referrerId, dealId } },
    update: {
      referralCount: { increment: 1 },
    },
    create: {
      userId: referrerId,
      dealId,
      referralCount: 1,
    },
  });

  // Check if bounty is now complete
  if (
    !progress.isCompleted &&
    progress.referralCount >= (deal.minReferralsRequired || 1)
  ) {
    await completeBounty(referrerId, dealId);
  }

  return progress;
}

/**
 * Complete a bounty and award rewards
 */
async function completeBounty(userId: number, dealId: number) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal || !deal.bountyRewardAmount) return;

  await prisma.$transaction(async (tx) => {
    // Mark bounty as completed
    await tx.bountyProgress.update({
      where: { userId_dealId: { userId, dealId } },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        rewardsEarned: deal.bountyRewardAmount!,
      },
    });

    // Increment redemption count on the deal
    await tx.deal.update({
      where: { id: dealId },
      data: { currentRedemptions: { increment: 1 } },
    });
  });

  // Award coins outside the transaction to avoid nested tx issues
  await awardCoins(
    userId,
    Math.floor(deal.bountyRewardAmount * 10), // Convert dollar reward to coins (e.g. $5 = 50 coins)
    CoinTransactionType.BONUS,
    `Bounty deal completed: ${deal.title}`,
    { dealId, bountyRewardAmount: deal.bountyRewardAmount }
  );
}

/**
 * Verify a bounty QR code scan
 */
export async function verifyBountyScan(userId: number, qrCodeData: string) {
  const verified = verifyBountyQRCode(qrCodeData);
  if (!verified) {
    throw new Error('Invalid or expired QR code');
  }

  const { dealId, merchantId } = verified;

  const progress = await prisma.bountyProgress.findUnique({
    where: { userId_dealId: { userId, dealId } },
  });

  if (!progress) {
    throw new Error('No bounty progress found for this deal');
  }

  if (progress.qrCodeScannedAt) {
    throw new Error('QR code already scanned for this bounty');
  }

  const updated = await prisma.bountyProgress.update({
    where: { userId_dealId: { userId, dealId } },
    data: { qrCodeScannedAt: new Date() },
  });

  return { verified: true, dealId, merchantId, progress: updated };
}

/**
 * Get user's bounty dashboard
 */
export async function getUserBountyDashboard(userId: number) {
  const bounties = await prisma.bountyProgress.findMany({
    where: { userId },
    include: {
      deal: {
        include: {
          merchant: { select: { id: true, businessName: true, logoUrl: true } },
          dealType: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  const active = bounties.filter((b) => !b.isCompleted);
  const completed = bounties.filter((b) => b.isCompleted);

  return {
    active: active.map((b) => ({
      id: b.id,
      dealId: b.dealId,
      dealTitle: b.deal.title,
      merchant: b.deal.merchant,
      referralCount: b.referralCount,
      minReferralsRequired: b.deal.minReferralsRequired,
      bountyRewardAmount: b.deal.bountyRewardAmount,
      progress: b.deal.minReferralsRequired
        ? Math.min(100, (b.referralCount / b.deal.minReferralsRequired) * 100)
        : 0,
      qrScanned: !!b.qrCodeScannedAt,
      startedAt: b.createdAt,
    })),
    completed: completed.map((b) => ({
      id: b.id,
      dealId: b.dealId,
      dealTitle: b.deal.title,
      merchant: b.deal.merchant,
      referralCount: b.referralCount,
      rewardsEarned: b.rewardsEarned,
      completedAt: b.completedAt,
    })),
    stats: {
      totalActive: active.length,
      totalCompleted: completed.length,
      totalRewardsEarned: completed.reduce((sum, b) => sum + b.rewardsEarned, 0),
    },
  };
}

/**
 * Generate a fresh bounty QR code for a deal (merchant use)
 */
export async function refreshBountyQRCode(dealId: number, merchantId: number) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, merchantId },
    include: { dealType: true },
  });

  if (!deal) {
    throw new Error('Deal not found for this merchant');
  }

  if (deal.dealType.name !== 'Bounty Deal') {
    throw new Error('This deal is not a bounty deal');
  }

  const qrCode = generateBountyQRCode(dealId, merchantId);

  await prisma.deal.update({
    where: { id: dealId },
    data: { bountyQRCode: qrCode },
  });

  return { qrCode, dealId, merchantId };
}
