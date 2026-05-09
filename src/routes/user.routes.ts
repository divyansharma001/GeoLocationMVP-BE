import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { getPointConfig } from '../lib/points';
import { invalidateLeaderboardCache } from '../lib/leaderboard/cache';
import { updateStreakAfterCheckIn } from '../lib/streak';
import { POINT_EVENT_TYPES } from '../constants/points';
import { haversineMeters } from '../lib/geo';
import { getEligibleCheckInRewardsForUser } from '../services/venue-reward.service';
import { registerCheckInLotteryEntry } from '../services/checkin-lottery.service';
import { createCheckInGameSessionForCheckIn } from '../services/checkin-game.service';
import {
  DEFAULT_TRUCK_RADIUS_METERS,
  resolveScheduleStatusFor,
} from '../services/truck-schedule.service';
import { attributeReferralForAction } from '../services/referral-attribution.service';

const router = Router();

const shouldBypassCheckInGeo = () => {
  const raw = (process.env.CHECKIN_BYPASS_GEO || '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
};

// Validation schema for saving a deal
const saveDealSchema = z.object({
  dealId: z.number().int().positive({ message: "Deal ID must be a positive integer" }),
});

// Validation schema for check-in
const checkInSchema = z.object({
  dealId: z.number().int().positive(),
  latitude: z.number().refine(v => v >= -90 && v <= 90, { message: 'Latitude must be between -90 and 90.' }),
  longitude: z.number().refine(v => v >= -180 && v <= 180, { message: 'Longitude must be between -180 and 180.' })
});

// --- Endpoint: POST /api/users/save-deal ---
// Save a deal for the authenticated user
router.post('/save-deal', protect, async (req: AuthRequest, res: Response) => {
  try {
    const { dealId } = saveDealSchema.parse(req.body);
    const userId = req.user!.id;

    // Check if the deal exists
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: {
          select: {
            businessName: true,
            status: true
          }
        }
      }
    });

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Check if the deal is from an approved merchant
    if (deal.merchant.status !== 'APPROVED') {
      return res.status(400).json({ 
        error: 'Cannot save deals from unapproved merchants' 
      });
    }

    // Check if the deal is still valid (not expired)
    const now = new Date();
    if (deal.endTime < now) {
      return res.status(400).json({ 
        error: 'Cannot save expired deals' 
      });
    }

    // Check if the user has already saved this deal
    const existingSave = await prisma.userDeal.findUnique({
      where: {
        userId_dealId: {
          userId,
          dealId
        }
      }
    });

    if (existingSave) {
      return res.status(409).json({ 
        error: 'Deal already saved by this user' 
      });
    }

    // Save the deal
    const savedDeal = await prisma.userDeal.create({
      data: {
        userId,
        dealId
      },
      include: {
        deal: {
          include: {
            merchant: {
              select: {
                businessName: true,
                address: true,
                latitude: true,
                longitude: true,
                phoneNumber: true
              }
            },
            category: true,
            dealType: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Deal saved successfully',
      savedDeal: {
        id: savedDeal.id,
        savedAt: savedDeal.savedAt,
        deal: {
          id: savedDeal.deal.id,
          title: savedDeal.deal.title,
          description: savedDeal.deal.description,
          // imageUrl deprecated: schema now uses imageUrls (string[])
          imageUrls: savedDeal.deal.imageUrls,
          // Provide first image for backward compatibility with older clients expecting `imageUrl`
          imageUrl: savedDeal.deal.imageUrls?.[0] || null,
          discountPercentage: savedDeal.deal.discountPercentage,
          discountAmount: savedDeal.deal.discountAmount,
          category: savedDeal.deal.category,
          dealType: savedDeal.deal.dealType,
          recurringDays: savedDeal.deal.recurringDays,
          startTime: savedDeal.deal.startTime,
          endTime: savedDeal.deal.endTime,
          redemptionInstructions: savedDeal.deal.redemptionInstructions,
          merchant: savedDeal.deal.merchant
        }
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: error.issues });
    }
    console.error('Save deal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: POST /api/users/check-in ---
// Verifies that an authenticated user is physically near the merchant location for a given deal.
// Body: { dealId: number, latitude: number, longitude: number }
// Response: { dealId, merchantId, distanceMeters, withinRange, thresholdMeters, dealActive }
router.post('/check-in', protect, async (req: AuthRequest, res: Response) => {
  try {
    // Parse & validate input
    const parsed = checkInSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.issues });
    }
    const { dealId, latitude, longitude } = parsed.data;
    const userId = req.user!.id;

    // Fetch deal with merchant + stores. Truck stores need their schedule
    // resolved at check-in time so we validate against where the truck *is*,
    // not where it's registered.
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: {
          select: {
            id: true,
            status: true,
            businessName: true,
            latitude: true,
            longitude: true,
            stores: {
              where: { active: true },
              select: { id: true, latitude: true, longitude: true, isFoodTruck: true },
            },
          },
        },
      },
    });

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    if (deal.merchant.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Deal merchant is not approved' });
    }

    const now = new Date();
    const dealActive = deal.startTime <= now && deal.endTime >= now;
    if (!dealActive) {
      return res.status(400).json({ error: 'Deal is not currently active.' });
    }

    const { checkInRadiusMeters, checkInPoints, firstCheckInBonus } = getPointConfig();
    const thresholdMeters = checkInRadiusMeters;
    const bypassGeo = shouldBypassCheckInGeo();

    // Resolve truck schedules up-front (only for stores actually marked as trucks).
    const truckStores = deal.merchant.stores.filter((s) => s.isFoodTruck);
    const truckScheduleMap = truckStores.length
      ? await resolveScheduleStatusFor(truckStores.map((s) => s.id), now)
      : new Map();

    // Build the list of valid "anchor" coordinates the user can be near:
    //   - Each fixed store's coords (radius = standard checkInRadiusMeters)
    //   - Each truck's currentStop coords (radius = stop override or DEFAULT_TRUCK_RADIUS_METERS)
    type Anchor = { lat: number; lng: number; radius: number; storeId: number | null; isTruck: boolean };
    const anchors: Anchor[] = [];

    for (const store of deal.merchant.stores) {
      if (store.isFoodTruck) {
        const status = truckScheduleMap.get(store.id);
        if (status?.current) {
          anchors.push({
            lat: status.current.latitude,
            lng: status.current.longitude,
            radius: status.current.radiusMeters ?? DEFAULT_TRUCK_RADIUS_METERS,
            storeId: store.id,
            isTruck: true,
          });
        }
      } else if (store.latitude != null && store.longitude != null) {
        anchors.push({
          lat: store.latitude,
          lng: store.longitude,
          radius: thresholdMeters,
          storeId: store.id,
          isTruck: false,
        });
      }
    }

    // Backwards-compat: if there are no per-store anchors but the merchant has
    // top-level coords (legacy data), fall back to checking against those.
    if (anchors.length === 0 && deal.merchant.latitude != null && deal.merchant.longitude != null) {
      anchors.push({
        lat: deal.merchant.latitude,
        lng: deal.merchant.longitude,
        radius: thresholdMeters,
        storeId: null,
        isTruck: false,
      });
    }

    // No usable anchor at all — could be a truck with no live stop, or a
    // misconfigured merchant.
    if (anchors.length === 0) {
      const merchantHasOnlyTrucks = truckStores.length > 0 && deal.merchant.stores.length === truckStores.length;
      if (merchantHasOnlyTrucks) {
        // Determine why: are there ANY non-cancelled stops with endsAt >= now?
        const upcomingCount = await prisma.scheduledStop.count({
          where: {
            storeId: { in: truckStores.map((s) => s.id) },
            status: { in: ['SCHEDULED', 'LIVE'] },
            endsAt: { gte: now },
          },
        });
        return res.status(200).json({
          dealId: deal.id,
          merchantId: deal.merchant.id,
          userId,
          distanceMeters: null,
          withinRange: false,
          thresholdMeters,
          bypassGeo,
          dealActive,
          pointsAwarded: 0,
          pointEvents: [],
          failureReason: upcomingCount > 0 ? 'TRUCK_NOT_LIVE' : 'TRUCK_NO_STOP_TODAY',
          merchantBusinessName: deal.merchant.businessName,
        });
      }
      return res.status(400).json({ error: 'Merchant location not set; cannot perform check-in.' });
    }

    // Distance to the *closest* anchor wins. We also remember which anchor matched
    // so the failure-reason copy can name the truck location if applicable.
    let bestDistance = Infinity;
    let bestAnchor: Anchor = anchors[0];
    for (const anchor of anchors) {
      const d = haversineMeters(latitude, longitude, anchor.lat, anchor.lng);
      if (d < bestDistance) {
        bestDistance = d;
        bestAnchor = anchor;
      }
    }

    const distanceMeters = bestDistance;
    const effectiveRadius = bestAnchor.radius;
    const withinRange = bypassGeo ? true : distanceMeters <= effectiveRadius;

    if (!withinRange) {
      // For mixed merchants, the failure is just OUT_OF_RANGE. For truck-only
      // merchants where the closest anchor is a truck stop, surface the address
      // for friendlier copy.
      let currentStopAddress: string | undefined;
      if (bestAnchor.isTruck && bestAnchor.storeId !== null) {
        const stopForAnchor = truckScheduleMap.get(bestAnchor.storeId)?.current;
        if (stopForAnchor) currentStopAddress = stopForAnchor.address;
      }
      return res.status(200).json({
        dealId: deal.id,
        merchantId: deal.merchant.id,
        userId,
        distanceMeters: Math.round(distanceMeters * 100) / 100,
        withinRange,
        thresholdMeters: effectiveRadius,
        bypassGeo,
        dealActive,
        pointsAwarded: 0,
        pointEvents: [],
        failureReason: 'OUT_OF_RANGE',
        merchantBusinessName: deal.merchant.businessName,
        currentStopAddress,
      });
    }

    // Use Serializable isolation to prevent race conditions where
    // concurrent requests could award double points for the same check-in
    const result = await prisma.$transaction(async (tx) => {
      // Check if user has an existing check-in for this deal
      const priorCheckIn = await tx.checkIn.findFirst({
        where: { userId, dealId: deal.id },
        select: { id: true }
      });

      // Create check-in record
      const checkIn = await tx.checkIn.create({
        data: {
          userId,
          dealId: deal.id,
          merchantId: deal.merchant.id,
          latitude,
          longitude,
          distanceMeters
        }
      });

      let totalAward = checkInPoints;
      const events: any[] = [];

      // Award first-checkin bonus if none exists
      if (!priorCheckIn) {
        totalAward += firstCheckInBonus;
        events.push(await tx.userPointEvent.create({
          data: {
            userId,
            dealId: deal.id,
            pointEventTypeId: POINT_EVENT_TYPES.FIRST_CHECKIN_DEAL,
            points: firstCheckInBonus
          }
        }));
      }

      // Always log generic check-in points
      events.push(await tx.userPointEvent.create({
        data: {
          userId,
          dealId: deal.id,
          pointEventTypeId: POINT_EVENT_TYPES.CHECKIN,
          points: checkInPoints
        }
      }));

      // Increment user total points
      await tx.user.update({
        where: { id: userId },
        data: ({ points: { increment: totalAward }, monthlyPoints: { increment: totalAward } } as any)
      });

      return { checkIn, totalAward, events, prior: !!priorCheckIn };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable
    });

  // Update streak after successful check-in
  const streakUpdate = await updateStreakAfterCheckIn(userId, now);

  // Best-effort referral attribution — credits the user who referred this
  // customer if the merchant has an active referral program. Never throws.
  void attributeReferralForAction({
    referredUserId: userId,
    merchantId: deal.merchant.id,
    triggerType: 'CHECKIN',
    triggerId: result.checkIn.id,
    dealId: deal.id,
  });

  // Get merchant-level rewards that become available as a result of this check-in.
  const eligibleRewards = await getEligibleCheckInRewardsForUser({
    userId,
    merchantId: deal.merchant.id,
    isFirstVisit: !result.prior,
  });

  // Register user into active global check-in lottery window, if one exists.
  let lotteryEntry: any = null;
  try {
    lotteryEntry = await registerCheckInLotteryEntry({
      userId,
      checkInId: result.checkIn.id,
      checkInAt: now,
    });
  } catch (lotteryError) {
    console.error('Lottery eligibility registration failed:', lotteryError);
  }

  let gameSession: any = null;
  try {
    gameSession = await createCheckInGameSessionForCheckIn({
      userId,
      merchantId: deal.merchant.id,
      checkInId: result.checkIn.id,
      checkInAt: now,
    });
  } catch (gameError) {
    console.error('Check-in mini game session creation failed:', gameError);
  }

  // Invalidate relevant caches (current month/day/week)
  invalidateLeaderboardCache('day');
  invalidateLeaderboardCache('month');
  invalidateLeaderboardCache('week');

    return res.status(200).json({
      dealId: deal.id,
      merchantId: deal.merchant.id,
      userId,
      distanceMeters: Math.round(distanceMeters * 100) / 100,
      withinRange: true,
      thresholdMeters,
      bypassGeo,
      dealActive,
      pointsAwarded: result.totalAward,
      firstCheckIn: !result.prior,
      pointEvents: result.events.map(e => ({ id: e.id, type: e.type, points: e.points })),
      eligibleRewards,
      lotteryEntry,
      gameSession,
      streak: {
        currentStreak: streakUpdate.streak.currentStreak,
        currentDiscountPercent: streakUpdate.discountPercent,
        message: streakUpdate.message,
        newWeek: streakUpdate.newWeek,
        streakBroken: streakUpdate.streakBroken,
        maxDiscountReached: streakUpdate.streak.maxDiscountReached,
      }
    });
  } catch (error) {
    console.error('Check-in error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: DELETE /api/users/save-deal/:dealId ---
// Remove a saved deal for the authenticated user
router.delete('/save-deal/:dealId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    const userId = req.user!.id;

    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'Invalid deal ID' });
    }

    // Check if the user has saved this deal
    const savedDeal = await prisma.userDeal.findUnique({
      where: {
        userId_dealId: {
          userId,
          dealId
        }
      }
    });

    if (!savedDeal) {
      return res.status(404).json({ 
        error: 'Deal not found in your saved deals' 
      });
    }

    // Remove the saved deal
    await prisma.userDeal.delete({
      where: {
        userId_dealId: {
          userId,
          dealId
        }
      }
    });

    res.status(200).json({
      message: 'Deal removed from saved deals successfully'
    });

  } catch (error) {
    console.error('Remove saved deal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/users/saved-deals ---
// Get all saved deals for the authenticated user (with pagination)
router.get('/saved-deals', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    const now = new Date();

    // Fetch paginated saved deals (only active ones)
    const [savedDeals, total] = await Promise.all([
      prisma.userDeal.findMany({
        where: {
          userId,
          deal: {
            endTime: { gte: now }
          }
        },
        include: {
          deal: {
            include: {
              merchant: {
                select: {
                  businessName: true,
                  address: true,
                  latitude: true,
                  longitude: true,
                  phoneNumber: true
                }
              },
              category: true,
              dealType: true
            }
          }
        },
        orderBy: { savedAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.userDeal.count({
        where: {
          userId,
          deal: {
            endTime: { gte: now }
          }
        }
      })
    ]);

    const formattedDeals = savedDeals.map((savedDeal: any) => ({
      id: savedDeal.id,
      savedAt: savedDeal.savedAt,
      deal: {
        id: savedDeal.deal.id,
        title: savedDeal.deal.title,
        description: savedDeal.deal.description,
        imageUrls: savedDeal.deal.imageUrls,
        imageUrl: savedDeal.deal.imageUrls?.[0] || null,
        discountPercentage: savedDeal.deal.discountPercentage,
        discountAmount: savedDeal.deal.discountAmount,
        category: savedDeal.deal.category,
        startTime: savedDeal.deal.startTime,
        endTime: savedDeal.deal.endTime,
        redemptionInstructions: savedDeal.deal.redemptionInstructions,
        merchant: savedDeal.deal.merchant
      }
    }));

    res.status(200).json({
      message: 'Saved deals retrieved successfully',
      savedDeals: formattedDeals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });

  } catch (error) {
    console.error('Get saved deals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/users/saved-deals/:dealId ---
// Check if a specific deal is saved by the authenticated user
router.get('/saved-deals/:dealId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    const userId = req.user!.id;

    if (isNaN(dealId)) {
      return res.status(400).json({ error: 'Invalid deal ID' });
    }

    const savedDeal = await prisma.userDeal.findUnique({
      where: {
        userId_dealId: {
          userId,
          dealId
        }
      }
    });

    res.status(200).json({
      isSaved: !!savedDeal,
      savedAt: savedDeal?.savedAt || null
    });

  } catch (error) {
    console.error('Check saved deal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Endpoint: GET /api/users/referrals ---
// Returns referral stats and optionally paginated list of referred users
router.get('/referrals', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    const includeUsers = req.query.includeUsers === 'true';

    // Fetch user's referral code and count in parallel
    const [user, referralCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        // @ts-ignore new field referralCode already in schema
        select: { referralCode: true }
      }),
      // @ts-ignore new field referredByUserId added in migration
      prisma.user.count({ where: { referredByUserId: userId } })
    ]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const response: any = {
      referralCode: (user as any).referralCode,
      referralCount
    };

    // Optionally include paginated list of referred users
    if (includeUsers) {
      // @ts-ignore new field referredByUserId added in migration
      const referredUsers = await prisma.user.findMany({
        where: { referredByUserId: userId },
        select: {
          id: true,
          name: true,
          avatarUrl: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      });

      response.referredUsers = referredUsers;
      response.pagination = {
        page,
        limit,
        total: referralCount,
        totalPages: Math.ceil(referralCount / limit),
        hasMore: page * limit < referralCount
      };
    }

    return res.status(200).json(response);
  } catch (err) {
    console.error('Get referrals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
