import { Router } from 'express';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';
import { SurpriseType } from '@prisma/client';
import prisma from '../lib/prisma';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/merchant/surprises
// Create a new surprise deal
// Body: { title, description, discountPercentage?, discountAmount?, categoryId,
//         dealTypeId, startTime, endTime, redemptionInstructions,
//         surpriseType, surpriseHint, revealRadiusMeters?, revealAt?,
//         revealDurationMinutes?, surpriseTotalSlots? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const {
      title,
      description,
      discountPercentage,
      discountAmount,
      categoryId,
      dealTypeId,
      startTime,
      endTime,
      redemptionInstructions,
      surpriseType,
      surpriseHint,
      revealRadiusMeters,
      revealAt,
      revealDurationMinutes,
      surpriseTotalSlots,
    } = req.body;

    // Required fields
    if (!title || !description || !categoryId || !dealTypeId || !startTime || !endTime || !redemptionInstructions) {
      return res.status(400).json({ error: 'title, description, categoryId, dealTypeId, startTime, endTime, and redemptionInstructions are required.' });
    }

    if (!surpriseType || !Object.values(SurpriseType).includes(surpriseType)) {
      return res.status(400).json({ error: `surpriseType must be one of: ${Object.values(SurpriseType).join(', ')}` });
    }

    if (surpriseType === SurpriseType.LOCATION_BASED && !revealRadiusMeters) {
      return res.status(400).json({ error: 'revealRadiusMeters is required for LOCATION_BASED surprises.' });
    }

    if (surpriseType === SurpriseType.TIME_BASED && !revealAt) {
      return res.status(400).json({ error: 'revealAt is required for TIME_BASED surprises.' });
    }

    const deal = await prisma.deal.create({
      data: {
        title,
        description,
        discountPercentage: discountPercentage ?? null,
        discountAmount: discountAmount ?? null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        redemptionInstructions,
        merchantId: req.merchant!.id,
        categoryId: parseInt(categoryId),
        dealTypeId: parseInt(dealTypeId),
        isSurprise: true,
        surpriseType,
        surpriseHint: surpriseHint ?? null,
        revealRadiusMeters: revealRadiusMeters ? parseInt(revealRadiusMeters) : null,
        revealAt: revealAt ? new Date(revealAt) : null,
        revealDurationMinutes: revealDurationMinutes ? parseInt(revealDurationMinutes) : 60,
        surpriseTotalSlots: surpriseTotalSlots ? parseInt(surpriseTotalSlots) : null,
      },
      include: {
        category: { select: { name: true } },
        dealType: { select: { name: true } },
      },
    });

    res.status(201).json({ message: 'Surprise deal created.', deal });
  } catch (err) {
    console.error('[MerchantSurprise] create error:', err);
    res.status(500).json({ error: 'Failed to create surprise deal.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/merchant/surprises
// List all surprise deals for this merchant (with slot usage)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const deals = await prisma.deal.findMany({
      where: { merchantId: req.merchant!.id, isSurprise: true },
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true, icon: true } },
        dealType: { select: { name: true } },
        _count: { select: { surpriseReveals: true } },
      },
    });

    const now = new Date();
    const result = deals.map((d) => ({
      ...d,
      isActive: d.startTime <= now && d.endTime >= now,
      revealsCount: d._count.surpriseReveals,
    }));

    res.json({ deals: result, count: result.length });
  } catch (err) {
    console.error('[MerchantSurprise] list error:', err);
    res.status(500).json({ error: 'Failed to fetch surprise deals.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/merchant/surprises/:dealId
// Update a surprise deal (only if not yet started)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:dealId', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { merchantId: true, isSurprise: true, startTime: true },
    });

    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    if (deal.merchantId !== req.merchant!.id) return res.status(403).json({ error: 'Not your deal.' });
    if (!deal.isSurprise) return res.status(400).json({ error: 'This is not a surprise deal.' });
    if (deal.startTime <= new Date()) return res.status(400).json({ error: 'Cannot edit an active or past surprise deal.' });

    const {
      title, description, surpriseHint, revealRadiusMeters,
      revealAt, revealDurationMinutes, surpriseTotalSlots, endTime,
    } = req.body;

    const updated = await prisma.deal.update({
      where: { id: dealId },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(surpriseHint !== undefined && { surpriseHint }),
        ...(revealRadiusMeters !== undefined && { revealRadiusMeters: parseInt(revealRadiusMeters) }),
        ...(revealAt !== undefined && { revealAt: revealAt ? new Date(revealAt) : null }),
        ...(revealDurationMinutes !== undefined && { revealDurationMinutes: parseInt(revealDurationMinutes) }),
        ...(surpriseTotalSlots !== undefined && { surpriseTotalSlots: surpriseTotalSlots ? parseInt(surpriseTotalSlots) : null }),
        ...(endTime && { endTime: new Date(endTime) }),
      },
    });

    res.json({ message: 'Surprise deal updated.', deal: updated });
  } catch (err) {
    console.error('[MerchantSurprise] update error:', err);
    res.status(500).json({ error: 'Failed to update surprise deal.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/merchant/surprises/:dealId
// Soft-delete by setting endTime to now (expires immediately)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:dealId', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { merchantId: true, isSurprise: true },
    });

    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    if (deal.merchantId !== req.merchant!.id) return res.status(403).json({ error: 'Not your deal.' });
    if (!deal.isSurprise) return res.status(400).json({ error: 'This is not a surprise deal.' });

    await prisma.deal.update({
      where: { id: dealId },
      data: { endTime: new Date() },
    });

    res.json({ message: 'Surprise deal deactivated.' });
  } catch (err) {
    console.error('[MerchantSurprise] delete error:', err);
    res.status(500).json({ error: 'Failed to deactivate surprise deal.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/merchant/surprises/:dealId/analytics
// Reveals count, redeems count, conversion rate, slot usage
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:dealId/analytics', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        merchantId: true,
        isSurprise: true,
        surpriseTotalSlots: true,
        surpriseSlotsUsed: true,
        title: true,
        surpriseType: true,
        startTime: true,
        endTime: true,
      },
    });

    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    if (deal.merchantId !== req.merchant!.id) return res.status(403).json({ error: 'Not your deal.' });
    if (!deal.isSurprise) return res.status(400).json({ error: 'This is not a surprise deal.' });

    const [totalReveals, totalRedeemed, recentReveals] = await Promise.all([
      prisma.userSurpriseReveal.count({ where: { dealId } }),
      prisma.userSurpriseReveal.count({ where: { dealId, redeemed: true } }),
      prisma.userSurpriseReveal.findMany({
        where: { dealId },
        orderBy: { revealedAt: 'desc' },
        take: 10,
        select: { revealedAt: true, redeemed: true, redeemedAt: true },
      }),
    ]);

    const conversionRate = totalReveals > 0 ? Math.round((totalRedeemed / totalReveals) * 100) : 0;

    res.json({
      deal: {
        id: dealId,
        title: deal.title,
        surpriseType: deal.surpriseType,
        startTime: deal.startTime,
        endTime: deal.endTime,
      },
      analytics: {
        totalReveals,
        totalRedeemed,
        conversionRate: `${conversionRate}%`,
        slotsTotal: deal.surpriseTotalSlots ?? 'unlimited',
        slotsUsed: deal.surpriseSlotsUsed,
        slotsRemaining:
          deal.surpriseTotalSlots !== null
            ? deal.surpriseTotalSlots - deal.surpriseSlotsUsed
            : 'unlimited',
      },
      recentReveals,
    });
  } catch (err) {
    console.error('[MerchantSurprise] analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

export default router;
