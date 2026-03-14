import { Prisma, SurpriseType } from '@prisma/client';
import prisma from './prisma';
import logger from './logging/logger';

const DEFAULT_SURPRISE_HINT = 'Something special is waiting for you...';

type NearbyReveal = {
  id: number;
  redeemed: boolean;
  expiresAt: Date;
};

type RevealDeal = Prisma.DealGetPayload<{
  include: {
    merchant: { select: { id: true, businessName: true, latitude: true, longitude: true, logoUrl: true } };
    category: { select: { name: true, icon: true } };
    dealType: { select: { name: true } };
    surpriseReveals: { where: { userId: number }; select: { id: true, expiresAt: true, redeemed: true } };
  };
}>;

class SurpriseServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'ALREADY_REVEALED' | 'SLOTS_EXHAUSTED'
  ) {
    super(message);
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class SurpriseService {
  async getNearbySurprises(userId: number, lat: number, lng: number, radiusKm = 10) {
    const now = new Date();
    const bounds = this.getBoundingBox(lat, lng, radiusKm);

    const deals = await prisma.deal.findMany({
      where: {
        isSurprise: true,
        startTime: { lte: now },
        endTime: { gte: now },
        merchant: {
          latitude: { gte: bounds.minLat, lte: bounds.maxLat },
          longitude: { gte: bounds.minLng, lte: bounds.maxLng },
        },
      },
      select: {
        id: true,
        surpriseHint: true,
        surpriseType: true,
        revealRadiusMeters: true,
        revealAt: true,
        merchant: {
          select: {
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

    return deals
      .map((deal) => {
        const merchantLat = deal.merchant.latitude;
        const merchantLng = deal.merchant.longitude;

        if (merchantLat == null || merchantLng == null) {
          return null;
        }

        const distanceMeters = haversineMeters(lat, lng, merchantLat, merchantLng);
        if (distanceMeters > radiusKm * 1000) {
          return null;
        }

        const existingReveal = (deal.surpriseReveals[0] ?? null) as NearbyReveal | null;
        const isRevealed = !!existingReveal && existingReveal.expiresAt > now;
        const isExpired = !!existingReveal && existingReveal.expiresAt <= now;

        return {
          id: deal.id,
          hint: deal.surpriseHint ?? DEFAULT_SURPRISE_HINT,
          surpriseType: deal.surpriseType,
          merchantName: deal.merchant.businessName,
          merchantLogoUrl: deal.merchant.logoUrl,
          distanceMeters: Math.round(distanceMeters),
          isRevealed,
          isExpired,
          isRedeemed: existingReveal?.redeemed ?? false,
          ...(isRevealed && !existingReveal?.redeemed
            ? { expiresAt: existingReveal.expiresAt }
            : {}),
          revealRadiusMeters:
            deal.surpriseType === SurpriseType.LOCATION_BASED
              ? deal.revealRadiusMeters
              : undefined,
          revealAt: deal.surpriseType === SurpriseType.TIME_BASED ? deal.revealAt : undefined,
        };
      })
      .filter((deal): deal is NonNullable<typeof deal> => deal !== null);
  }

  async revealSurprise(
    userId: number,
    dealId: number,
    options: { lat?: number; lng?: number } = {}
  ) {
    const now = new Date();

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: {
          select: { id: true, businessName: true, latitude: true, longitude: true, logoUrl: true },
        },
        category: { select: { name: true, icon: true } },
        dealType: { select: { name: true } },
        surpriseReveals: {
          where: { userId },
          select: { id: true, expiresAt: true, redeemed: true },
        },
      },
    });

    if (!deal) return { success: false, error: 'Deal not found.' };
    if (!deal.isSurprise) return { success: false, error: 'This deal is not a surprise deal.' };
    if (deal.startTime > now || deal.endTime < now) {
      return { success: false, error: 'This surprise deal is not currently active.' };
    }

    const existingReveal = deal.surpriseReveals[0];
    if (existingReveal) {
      if (existingReveal.expiresAt > now) {
        return {
          success: false,
          error: 'You have already revealed this surprise.',
          alreadyRevealed: true,
        };
      }

      return { success: false, error: 'Your reveal window for this surprise has expired.' };
    }

    if (deal.surpriseTotalSlots !== null && deal.surpriseSlotsUsed >= deal.surpriseTotalSlots) {
      return { success: false, error: 'All surprise slots have been claimed.' };
    }

    const triggerError = await this.validateTrigger(userId, deal, options, now);
    if (triggerError) {
      return { success: false, error: triggerError };
    }

    const revealDurationMs = (deal.revealDurationMinutes ?? 60) * 60 * 1000;
    const expiresAt = new Date(now.getTime() + revealDurationMs);

    try {
      const reveal = await prisma.$transaction(async (tx) => {
        const createdReveal = await tx.userSurpriseReveal.create({
          data: { userId, dealId, expiresAt },
        });

        if (deal.surpriseTotalSlots !== null) {
          const slotUpdate = await tx.deal.updateMany({
            where: {
              id: dealId,
              surpriseSlotsUsed: { lt: deal.surpriseTotalSlots },
            },
            data: { surpriseSlotsUsed: { increment: 1 } },
          });

          if (slotUpdate.count === 0) {
            throw new SurpriseServiceError('All surprise slots have been claimed.', 'SLOTS_EXHAUSTED');
          }
        } else {
          await tx.deal.update({
            where: { id: dealId },
            data: { surpriseSlotsUsed: { increment: 1 } },
          });
        }

        return createdReveal;
      });

      logger.info(`[Surprise] User ${userId} revealed deal ${dealId}, expires ${expiresAt.toISOString()}`);

      return {
        success: true,
        revealId: reveal.id,
        expiresAt,
        deal: this.toRevealDealResponse(deal),
      };
    } catch (error) {
      if (error instanceof SurpriseServiceError) {
        return { success: false, error: error.message };
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return {
          success: false,
          error: 'You have already revealed this surprise.',
          alreadyRevealed: true,
        };
      }

      throw error;
    }
  }

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

  private async validateTrigger(
    userId: number,
    deal: RevealDeal,
    options: { lat?: number; lng?: number },
    now: Date
  ): Promise<string | null> {
    switch (deal.surpriseType) {
      case SurpriseType.LOCATION_BASED: {
        if (options.lat == null || options.lng == null) {
          return 'Your location is required to reveal this surprise.';
        }

        if (deal.merchant.latitude == null || deal.merchant.longitude == null) {
          return 'Merchant location is not available.';
        }

        const distance = haversineMeters(
          options.lat,
          options.lng,
          deal.merchant.latitude,
          deal.merchant.longitude
        );
        const requiredDistance = deal.revealRadiusMeters ?? 200;

        if (distance > requiredDistance) {
          return `You need to be within ${requiredDistance}m of ${deal.merchant.businessName} to reveal this surprise. You are ${Math.round(distance)}m away.`;
        }

        return null;
      }

      case SurpriseType.TIME_BASED:
        if (!deal.revealAt || now >= deal.revealAt) {
          return null;
        }

        return `This surprise will be revealed at ${deal.revealAt.toISOString()}.`;

      case SurpriseType.ENGAGEMENT_BASED: {
        const recentCheckIn = await prisma.checkIn.findFirst({
          where: {
            userId,
            merchantId: deal.merchant.id,
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
          select: { id: true },
        });

        return recentCheckIn ? null : 'You must check in at this merchant to reveal this surprise.';
      }

      case SurpriseType.RANDOM_DROP:
      default:
        return null;
    }
  }

  private getBoundingBox(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta,
    };
  }

  private toRevealDealResponse(deal: RevealDeal) {
    return {
      id: deal.id,
      title: deal.title,
      description: deal.description,
      discountPercentage: deal.discountPercentage,
      discountAmount: deal.discountAmount,
      redemptionInstructions: deal.redemptionInstructions,
      startTime: deal.startTime,
      endTime: deal.endTime,
      merchant: {
        id: deal.merchant.id,
        businessName: deal.merchant.businessName,
        latitude: deal.merchant.latitude,
        longitude: deal.merchant.longitude,
      },
      category: deal.category,
      dealType: deal.dealType,
    };
  }
}
