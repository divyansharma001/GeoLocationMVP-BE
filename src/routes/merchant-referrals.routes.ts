// src/routes/merchant-referrals.routes.ts
//
// Merchant-facing CRUD for referral programs.
// Free-text reward fields in v1 — structured payouts + attribution come later.

import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const parseIntParam = (raw: unknown): number | null => {
  if (raw === undefined || raw === null) return null;
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
};

interface ProgramPayload {
  name: string;
  description?: string | null;
  rewardForReferrer: string;
  rewardForReferred: string;
  isActive?: boolean;
  maxRedemptionsPerUser?: number | null;
  expiresAt?: string | null;
}

const validatePayload = (
  body: Partial<ProgramPayload>,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; data: any } | { ok: false; error: string } => {
  const out: any = {};

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { ok: false, error: 'name is required' };
    out.name = body.name.trim().slice(0, 200);
  }

  if (body.description !== undefined) {
    out.description = body.description ? String(body.description).slice(0, 1000) : null;
  }

  if (!partial || body.rewardForReferrer !== undefined) {
    if (typeof body.rewardForReferrer !== 'string' || !body.rewardForReferrer.trim()) {
      return { ok: false, error: 'rewardForReferrer is required' };
    }
    out.rewardForReferrer = body.rewardForReferrer.trim().slice(0, 300);
  }

  if (!partial || body.rewardForReferred !== undefined) {
    if (typeof body.rewardForReferred !== 'string' || !body.rewardForReferred.trim()) {
      return { ok: false, error: 'rewardForReferred is required' };
    }
    out.rewardForReferred = body.rewardForReferred.trim().slice(0, 300);
  }

  if (typeof body.isActive === 'boolean') out.isActive = body.isActive;

  if (body.maxRedemptionsPerUser !== undefined) {
    if (body.maxRedemptionsPerUser === null) {
      out.maxRedemptionsPerUser = null;
    } else {
      const n = parseInt(String(body.maxRedemptionsPerUser), 10);
      if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'maxRedemptionsPerUser must be a positive integer or null' };
      out.maxRedemptionsPerUser = n;
    }
  }

  if (body.expiresAt !== undefined) {
    if (body.expiresAt === null || body.expiresAt === '') {
      out.expiresAt = null;
    } else {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) return { ok: false, error: 'expiresAt must be a valid ISO timestamp or null' };
      out.expiresAt = d;
    }
  }

  return { ok: true, data: out };
};

async function loadOwned(req: AuthRequest, res: Response, programId: number) {
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    res.status(401).json({ error: 'Merchant authentication required' });
    return null;
  }
  const program = await prisma.merchantReferralProgram.findFirst({
    where: { id: programId, merchantId },
  });
  if (!program) {
    res.status(404).json({ error: 'Referral program not found' });
    return null;
  }
  return program;
}

// ─── List ─────────────────────────────────────────────────────────────────────

// ─── Leaderboard / stats ──────────────────────────────────────────────────────
//
// Aggregated attribution data: total count, top referrers, recent attributions.
// Optional `?programId=N` to filter to a single program.
//
// IMPORTANT: this route MUST be declared before `/merchants/me/referral-programs/:id`
// so Express doesn't try to parse "leaderboard" as an id.

router.get('/merchants/me/referral-programs/leaderboard', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const programIdRaw = req.query.programId;
    const programIdFilter = programIdRaw ? parseIntParam(programIdRaw) : null;

    const where: any = { merchantId };
    if (programIdFilter !== null) where.programId = programIdFilter;

    const [total, byReferrer, recent] = await Promise.all([
      prisma.referralAttribution.count({ where }),
      prisma.referralAttribution.groupBy({
        by: ['referrerUserId'],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      prisma.referralAttribution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          referrer: { select: { id: true, name: true, avatarUrl: true } },
          referred: { select: { id: true, name: true } },
          program: { select: { id: true, name: true } },
        },
      }),
    ]);

    const referrerIds = byReferrer.map((r) => r.referrerUserId);
    const referrerUsers = referrerIds.length
      ? await prisma.user.findMany({
          where: { id: { in: referrerIds } },
          select: { id: true, name: true, avatarUrl: true },
        })
      : [];
    const userById = new Map(referrerUsers.map((u) => [u.id, u]));

    const topReferrers = byReferrer.map((row) => ({
      userId: row.referrerUserId,
      name: userById.get(row.referrerUserId)?.name ?? `User #${row.referrerUserId}`,
      avatarUrl: userById.get(row.referrerUserId)?.avatarUrl ?? null,
      attributions: row._count._all,
    }));

    res.status(200).json({ total, topReferrers, recent });
  } catch (err) {
    console.error('[Referrals] leaderboard failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/merchants/me/referral-programs', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const includeInactive = req.query.includeInactive === 'true';
    const where: any = { merchantId };
    if (!includeInactive) where.isActive = true;

    const programs = await prisma.merchantReferralProgram.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json({ programs, total: programs.length });
  } catch (err) {
    console.error('[Referrals] list failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get('/merchants/me/referral-programs/:id', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const program = await loadOwned(req, res, id);
    if (!program) return;
    res.status(200).json({ program });
  } catch (err) {
    console.error('[Referrals] get failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post('/merchants/me/referral-programs', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const validated = validatePayload(req.body || {});
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const program = await prisma.merchantReferralProgram.create({
      data: { merchantId, ...validated.data },
    });
    res.status(201).json({ program });
  } catch (err) {
    console.error('[Referrals] create failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────

router.put('/merchants/me/referral-programs/:id', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const existing = await loadOwned(req, res, id);
    if (!existing) return;

    const validated = validatePayload(req.body || {}, { partial: true });
    if (!validated.ok) return res.status(400).json({ error: validated.error });

    const program = await prisma.merchantReferralProgram.update({
      where: { id },
      data: validated.data,
    });
    res.status(200).json({ program });
  } catch (err) {
    console.error('[Referrals] update failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Delete (soft by default) ────────────────────────────────────────────────

router.delete('/merchants/me/referral-programs/:id', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const existing = await loadOwned(req, res, id);
    if (!existing) return;

    const hard = req.query.hard === 'true';
    if (hard) {
      await prisma.merchantReferralProgram.delete({ where: { id } });
      return res.status(200).json({ message: 'Referral program permanently removed' });
    }
    await prisma.merchantReferralProgram.update({ where: { id }, data: { isActive: false } });
    res.status(200).json({ message: 'Referral program archived' });
  } catch (err) {
    console.error('[Referrals] delete failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
