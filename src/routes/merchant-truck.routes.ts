// src/routes/merchant-truck.routes.ts
//
// Merchant-facing food truck schedule routes.
// All paths assume mounting under /api in app.ts.

import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';
import { requireMerchantVerified } from '../middleware/verification-lock.middleware';
import {
  annotateStopStatus,
  resolveScheduleStatusFor,
  resolveScheduleStatusForOne,
} from '../services/truck-schedule.service';

const router = Router();

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

const parseIntParam = (raw: unknown): number | null => {
  if (raw === undefined || raw === null) return null;
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
};

const parseStoreId = parseIntParam;
const parseStopId = parseIntParam;

/**
 * Verify the store belongs to the authenticated merchant AND is a food truck.
 * Returns the store row on success; sends a 4xx response and returns null otherwise.
 */
async function loadOwnedTruckStore(req: AuthRequest, res: Response, storeId: number) {
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    res.status(401).json({ error: 'Merchant authentication required' });
    return null;
  }
  const store = await prisma.store.findFirst({ where: { id: storeId, merchantId } });
  if (!store) {
    res.status(404).json({ error: 'Store not found' });
    return null;
  }
  if (!store.isFoodTruck) {
    res.status(400).json({ error: 'This store is not a food truck. Mark it as a food truck to manage its schedule.' });
    return null;
  }
  return store;
}

const validateStopPayload = (
  body: any,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; data: any } | { ok: false; error: string } => {
  const out: any = {};

  const requireOrSkip = (field: string, validator: () => string | null) => {
    if (body[field] === undefined) {
      if (partial) return null;
      return `${field} is required`;
    }
    return validator();
  };

  const dateError = (field: string) => {
    const v = body[field];
    if (typeof v !== 'string') return `${field} must be an ISO timestamp string`;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return `${field} is not a valid ISO timestamp`;
    out[field] = d;
    return null;
  };

  let err: string | null = null;
  err = requireOrSkip('startsAt', () => dateError('startsAt'));
  if (err) return { ok: false, error: err };
  err = requireOrSkip('endsAt', () => dateError('endsAt'));
  if (err) return { ok: false, error: err };

  err = requireOrSkip('latitude', () => {
    const lat = parseFloat(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'latitude must be between -90 and 90';
    out.latitude = lat;
    return null;
  });
  if (err) return { ok: false, error: err };

  err = requireOrSkip('longitude', () => {
    const lng = parseFloat(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'longitude must be between -180 and 180';
    out.longitude = lng;
    return null;
  });
  if (err) return { ok: false, error: err };

  err = requireOrSkip('address', () => {
    if (typeof body.address !== 'string' || !body.address.trim()) return 'address is required';
    out.address = body.address.trim();
    return null;
  });
  if (err) return { ok: false, error: err };

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return { ok: false, error: 'notes must be a string or null' };
    out.notes = body.notes ? String(body.notes).slice(0, 500) : null;
  }

  if (body.radiusMeters !== undefined && body.radiusMeters !== null) {
    const r = parseInt(body.radiusMeters, 10);
    if (!Number.isFinite(r) || r < 25 || r > 2000) {
      return { ok: false, error: 'radiusMeters must be an integer between 25 and 2000' };
    }
    out.radiusMeters = r;
  } else if (body.radiusMeters === null) {
    out.radiusMeters = null;
  }

  // Cross-field check: end must be after start (only when both are present in this payload)
  if (out.startsAt && out.endsAt && out.startsAt >= out.endsAt) {
    return { ok: false, error: 'endsAt must be after startsAt' };
  }

  return { ok: true, data: out };
};

// ───────────────────────────────────────────────────────────────────────────
// GET /api/merchants/trucks
// Overview of all of the merchant's food-truck stores with current/next stop.
// ───────────────────────────────────────────────────────────────────────────
router.get('/merchants/trucks', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const stores = await prisma.store.findMany({
      where: { merchantId, isFoodTruck: true },
      include: { city: true },
      orderBy: { createdAt: 'asc' },
    });

    const now = new Date();
    const statusMap = await resolveScheduleStatusFor(stores.map((s) => s.id), now);

    // Fetch upcoming stop counts per store in a single grouped query.
    const counts = await prisma.scheduledStop.groupBy({
      by: ['storeId'],
      where: {
        storeId: { in: stores.map((s) => s.id) },
        status: { in: ['SCHEDULED', 'LIVE'] },
        endsAt: { gte: now },
      },
      _count: { _all: true },
    });
    const countByStore = new Map(counts.map((c) => [c.storeId, c._count._all]));

    const trucks = stores.map((store) => {
      const status = statusMap.get(store.id) ?? { storeId: store.id, current: null, next: null };
      return {
        ...store,
        currentStop: status.current ? annotateStopStatus(status.current, now) : null,
        nextStop: status.next ? annotateStopStatus(status.next, now) : null,
        upcomingStopCount: countByStore.get(store.id) ?? 0,
      };
    });

    res.status(200).json({ total: trucks.length, trucks });
  } catch (err) {
    console.error('[Trucks] overview failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/merchants/stores/:storeId/schedule
// List stops for a truck store. Optional ?from=ISO&to=ISO range filter.
// ───────────────────────────────────────────────────────────────────────────
router.get('/merchants/stores/:storeId/schedule', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const storeId = parseStoreId(req.params.storeId);
    if (storeId === null) return res.status(400).json({ error: 'Invalid storeId' });

    const store = await loadOwnedTruckStore(req, res, storeId);
    if (!store) return;

    const where: any = { storeId };
    if (req.query.from) {
      const fromDate = new Date(req.query.from as string);
      if (Number.isNaN(fromDate.getTime())) return res.status(400).json({ error: 'Invalid `from` date' });
      where.endsAt = { gte: fromDate };
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to as string);
      if (Number.isNaN(toDate.getTime())) return res.status(400).json({ error: 'Invalid `to` date' });
      where.startsAt = { ...(where.startsAt ?? {}), lte: toDate };
    }

    const rows = await prisma.scheduledStop.findMany({
      where,
      orderBy: { startsAt: 'asc' },
    });
    const now = new Date();
    const stops = rows.map((s) => annotateStopStatus(s, now));
    res.status(200).json({ stops });
  } catch (err) {
    console.error('[Trucks] list schedule failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /api/merchants/stores/:storeId/schedule/current
// Server-resolved {current, next} snapshot.
// ───────────────────────────────────────────────────────────────────────────
router.get('/merchants/stores/:storeId/schedule/current', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const storeId = parseStoreId(req.params.storeId);
    if (storeId === null) return res.status(400).json({ error: 'Invalid storeId' });

    const store = await loadOwnedTruckStore(req, res, storeId);
    if (!store) return;

    const now = new Date();
    const status = await resolveScheduleStatusForOne(storeId, now);
    res.status(200).json({
      storeId,
      current: status.current ? annotateStopStatus(status.current, now) : null,
      next: status.next ? annotateStopStatus(status.next, now) : null,
    });
  } catch (err) {
    console.error('[Trucks] current schedule failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/merchants/stores/:storeId/schedule
// Create a stop.
// ───────────────────────────────────────────────────────────────────────────
router.post(
  '/merchants/stores/:storeId/schedule',
  protect,
  isApprovedMerchant,
  requireMerchantVerified,
  async (req: AuthRequest, res) => {
    try {
      const storeId = parseStoreId(req.params.storeId);
      if (storeId === null) return res.status(400).json({ error: 'Invalid storeId' });

      const store = await loadOwnedTruckStore(req, res, storeId);
      if (!store) return;

      const validated = validateStopPayload(req.body || {});
      if (!validated.ok) return res.status(400).json({ error: validated.error });

      const stop = await prisma.scheduledStop.create({
        data: {
          storeId,
          ...validated.data,
          status: 'SCHEDULED',
        },
      });

      res.status(201).json({ stop: annotateStopStatus(stop) });
    } catch (err) {
      console.error('[Trucks] create stop failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// PUT /api/merchants/stores/:storeId/schedule/:stopId
// Update a stop. All fields optional; cross-field checks still enforced.
// ───────────────────────────────────────────────────────────────────────────
router.put(
  '/merchants/stores/:storeId/schedule/:stopId',
  protect,
  isApprovedMerchant,
  requireMerchantVerified,
  async (req: AuthRequest, res) => {
    try {
      const storeId = parseStoreId(req.params.storeId);
      const stopId = parseStopId(req.params.stopId);
      if (storeId === null || stopId === null) return res.status(400).json({ error: 'Invalid id' });

      const store = await loadOwnedTruckStore(req, res, storeId);
      if (!store) return;

      const existing = await prisma.scheduledStop.findFirst({ where: { id: stopId, storeId } });
      if (!existing) return res.status(404).json({ error: 'Stop not found' });

      const validated = validateStopPayload(req.body || {}, { partial: true });
      if (!validated.ok) return res.status(400).json({ error: validated.error });

      // Fold the partial update into existing values to re-check the cross-field invariant.
      const merged = {
        startsAt: validated.data.startsAt ?? existing.startsAt,
        endsAt: validated.data.endsAt ?? existing.endsAt,
      };
      if (merged.startsAt >= merged.endsAt) {
        return res.status(400).json({ error: 'endsAt must be after startsAt' });
      }

      const stop = await prisma.scheduledStop.update({
        where: { id: stopId },
        data: validated.data,
      });

      res.status(200).json({ stop: annotateStopStatus(stop) });
    } catch (err) {
      console.error('[Trucks] update stop failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// DELETE /api/merchants/stores/:storeId/schedule/:stopId
// ───────────────────────────────────────────────────────────────────────────
router.delete(
  '/merchants/stores/:storeId/schedule/:stopId',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const storeId = parseStoreId(req.params.storeId);
      const stopId = parseStopId(req.params.stopId);
      if (storeId === null || stopId === null) return res.status(400).json({ error: 'Invalid id' });

      const store = await loadOwnedTruckStore(req, res, storeId);
      if (!store) return;

      const existing = await prisma.scheduledStop.findFirst({ where: { id: stopId, storeId } });
      if (!existing) return res.status(404).json({ error: 'Stop not found' });

      await prisma.scheduledStop.delete({ where: { id: stopId } });
      res.status(200).json({ message: 'Stop removed' });
    } catch (err) {
      console.error('[Trucks] delete stop failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
