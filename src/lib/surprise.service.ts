import prisma from './prisma';
import { SurpriseType } from '@prisma/client';
import logger from './logging/logger';

// Haversine distance in meters
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class SurpriseService {
  /**
   * Get active surprise deals near a user (hints only — no deal details revealed)
   */
  async getNearbySurprises(
    userId: number,
    lat: number,
    lng: number,
    radiusKm: number = 10
  ) {
    const now = new Date();

    const deals = await prisma.deal.findMany({
      where: {
        isSurprise: true,
        startTime: { lte: now },
        endTime: { gte: now },
        merchant: {
          latitude: { not: null },
          longitude: { not: null },
        },
      },
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            latitude: true,
            longitude: true,
            logoUrl: true,
          },
        },
        surpriseReveals: {
          where: { userId },
          select: { id: true, redeemed: true, expiresAt: true },
        },
      },
    });

    const results = deals
      .map((deal) => {
        const mLat = deal.merchant.latitude!;
        const mLng = deal.merchant.longitude!;
        const distMeters = haversineMeters(lat, lng, mLat, mLng);

        if (distMeters > radiusKm * 1000) return null;

        const existingReveal = deal.surpriseReveals[0] ?? null;
        const isRevealed = !!existingReveal && existingReveal.expiresAt > now;
        const isExpired = !!existingReveal && existingReveal.expiresAt <= now;

        return {
          id: deal.id,
          hint: deal.surpriseHint ?? 'Something special is waiting for you…',
          surpriseType: deal.surpriseType,
          merchantName: deal.merchant.businessName,
          merchantLogoUrl: deal.merchant.logoUrl,
          distanceMeters: Math.round(distMeters),
          isRevealed,
          isExpired,
          isRedeemed: existingReveal?.redeemed ?? false,
          // Only expose these if already revealed
          ...(isRevealed && !existingReveal?.redeemed
            ? {
                expiresAt: existingReveal!.expiresAt,
              }
            : {}),
          // For LOCATION_BASED: hint about how close they need to be
          revealRadiusMeters:
            deal.surpriseType === SurpriseType.LOCATION_BASED
              ? deal.revealRadiusMeters
              : undefined,
          // For TIME_BASED: show reveal time
          revealAt:
            deal.surpriseType === SurpriseType.TIME_BASED ? deal.revealAt : undefined,
        };
      })
      .filter(Boolean);

    return results;
  }

  /**
   * Attempt to reveal a surprise deal for a user.
   * Validates the trigger condition based on surpriseType.
   */
  async revealSurprise(
    userId: number,
    dealId: number,
    options: { lat?: number; lng?: number; hasCheckedIn?: boolean } = {}
  ) {
    const now = new Date();

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: { select: { latitude: true, longitude: true, businessName: true } },
        surpriseReveals: { where: { userId }, select: { id: true, expiresAt: true, redeemed: true } },
      },
    });

    if (!deal) return { success: false, error: 'Deal not found.' };
    if (!deal.isSurprise) return { success: false, error: 'This deal is not a surprise deal.' };
    if (deal.startTime > now || deal.endTime < now)
      return { success: false, error: 'This surprise deal is not currently active.' };

    // Already revealed and still valid
    const existing = deal.surpriseReveals[0];
    if (existing) {
      if (existing.expiresAt > now) {
        return { success: false, error: 'You have already revealed this surprise.', alreadyRevealed: true };
      }
      return { success: false, error: 'Your reveal window for this surprise has expired.' };
    }

    // Check slot availability
    if (deal.surpriseTotalSlots !== null && deal.surpriseSlotsUsed >= deal.surpriseTotalSlots) {
      return { success: false, error: 'All surprise slots have been claimed.' };
    }

    // Validate trigger
    const triggerError = this.validateTrigger(deal, options, now);
    if (triggerError) return { success: false, error: triggerError };

    // Create reveal record
    const revealDurationMs = (deal.revealDurationMinutes ?? 60) * 60 * 1000;
    const expiresAt = new Date(now.getTime() + revealDurationMs);

    const [reveal] = await prisma.$transaction([
      prisma.userSurpriseReveal.create({
        data: { userId, dealId, expiresAt },
      }),
      prisma.deal.update({
        where: { id: dealId },
        data: { surpriseSlotsUsed: { increment: 1 } },
      }),
    ]);

    logger.info(`[Surprise] User ${userId} revealed deal ${dealId}, expires ${expiresAt}`);

    // Fetch full deal details to return after reveal
    const fullDeal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: { select: { id: true, businessName: true, latitude: true, longitude: true } },
        category: { select: { name: true, icon: true } },
        dealType: { select: { name: true } },
      },
    });

    return {
      success: true,
      revealId: reveal.id,
      expiresAt,
      deal: fullDeal,
    };
  }

  /**
   * Redeem a revealed surprise deal.
   */
  async redeemSurprise(userId: number, dealId: number) {
    const now = new Date();

    const reveal = await prisma.userSurpriseReveal.findUnique({
      where: { userId_dealId: { userId, dealId } },
    });

    if (!reveal) return { success: false, error: 'You have not revealed this surprise deal.' };
    if (reveal.redeemed) return { success: false, error: 'You have already redeemed this surprise.' };
    if (reveal.expiresAt <= now) return { success: false, error: 'Your reveal window has expired.' };

    await prisma.userSurpriseReveal.update({
      where: { userId_dealId: { userId, dealId } },
      data: { redeemed: true, redeemedAt: now },
    });

    logger.info(`[Surprise] User ${userId} redeemed surprise deal ${dealId}`);
    return { success: true };
  }

  /**
   * Get a user's reveal history.
   */
  async getUserRevealHistory(userId: number, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [reveals, total] = await Promise.all([
      prisma.userSurpriseReveal.findMany({
        where: { userId },
        orderBy: { revealedAt: 'desc' },
        skip,
        take: limit,
        include: {
          deal: {
            select: {
              id: true,
              title: true,
              surpriseHint: true,
              surpriseType: true,
              discountPercentage: true,
              discountAmount: true,
              merchant: { select: { businessName: true, logoUrl: true } },
            },
          },
        },
      }),
      prisma.userSurpriseReveal.count({ where: { userId } }),
    ]);

    return { reveals, total, page, limit };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private validateTrigger(
    deal: any,
    options: { lat?: number; lng?: number; hasCheckedIn?: boolean },
    now: Date
  ): string | null {
    switch (deal.surpriseType as SurpriseType) {
      case SurpriseType.LOCATION_BASED: {
        if (options.lat == null || options.lng == null)
          return 'Your location is required to reveal this surprise.';
        if (!deal.merchant.latitude || !deal.merchant.longitude)
          return 'Merchant location is not available.';
        const dist = haversineMeters(
          options.lat,
          options.lng,
          deal.merchant.latitude,
          deal.merchant.longitude
        );
        const required = deal.revealRadiusMeters ?? 200;
        if (dist > required)
          return `You need to be within ${required}m of ${deal.merchant.businessName} to reveal this surprise. You are ${Math.round(dist)}m away.`;
        return null;
      }

      case SurpriseType.TIME_BASED: {
        if (!deal.revealAt) return null;
        if (now < deal.revealAt)
          return `This surprise will be revealed at ${deal.revealAt.toISOString()}.`;
        return null;
      }

      case SurpriseType.ENGAGEMENT_BASED: {
        if (!options.hasCheckedIn)
          return 'You must check in at this merchant to reveal this surprise.';
        return null;
      }

      case SurpriseType.RANDOM_DROP:
        // Slot check already handled above — no extra trigger needed
        return null;

      default:
        return null;
    }
  }
}
