// src/routes/food-truck.routes.ts
//
// Public food-truck discovery routes. Mounted at /api/food-trucks in app.ts.

import { Router } from 'express';
import prisma from '../lib/prisma';
import { haversineMeters } from '../lib/geo';
import {
  annotateStopStatus,
  resolveScheduleStatusFor,
} from '../services/truck-schedule.service';

const router = Router();

const MILES_TO_KM = 1.609344;

// ───────────────────────────────────────────────────────────────────────────
// GET /api/food-trucks/nearby
// Query: lat, lng, radius (miles, default 10), liveOnly ('true' | 'false')
//
// Returns liveNow + upcoming partitions of food-truck stores whose currently
// active or next stop falls inside the radius.
// ───────────────────────────────────────────────────────────────────────────
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusMi = parseFloat((req.query.radius as string) ?? '10');
    const liveOnly = req.query.liveOnly === 'true';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required query parameters.' });
    }
    if (!Number.isFinite(radiusMi) || radiusMi <= 0 || radiusMi > 200) {
      return res.status(400).json({ error: 'radius must be a number between 0 and 200 miles.' });
    }
    const radiusMeters = radiusMi * MILES_TO_KM * 1000;

    // Fetch all active food-truck stores from APPROVED merchants.
    // Filtering by distance happens after we resolve their current stop, since
    // a truck's "where" today is the stop's coords, not the registered address.
    const stores = await prisma.store.findMany({
      where: {
        active: true,
        isFoodTruck: true,
        merchant: { status: 'APPROVED' },
      },
      include: {
        city: true,
        merchant: { select: { id: true, businessName: true, logoUrl: true } },
      },
    });

    if (stores.length === 0) {
      return res.json({ liveNow: [], upcoming: [], total: 0 });
    }

    const now = new Date();
    const statusMap = await resolveScheduleStatusFor(stores.map((s) => s.id), now);

    type Summary = {
      storeId: number;
      merchant: { id: number; businessName: string; logoUrl: string | null };
      city: { id: number; name: string; state: string } | null;
      registeredAddress: string;
      registeredLatitude: number | null;
      registeredLongitude: number | null;
      currentStop: ReturnType<typeof annotateStopStatus> | null;
      nextStop: ReturnType<typeof annotateStopStatus> | null;
      distanceKm: number | null;
    };

    const liveNow: Summary[] = [];
    const upcoming: Summary[] = [];

    for (const store of stores) {
      const status = statusMap.get(store.id);
      const current = status?.current ?? null;
      const next = status?.next ?? null;

      if (!current && !next) continue; // No live or upcoming stops — skip.
      if (liveOnly && !current) continue;

      const anchor = current ?? next!;
      const distanceM = haversineMeters(lat, lng, anchor.latitude, anchor.longitude);
      if (distanceM > radiusMeters) continue;

      const summary: Summary = {
        storeId: store.id,
        merchant: store.merchant,
        city: store.city ? { id: store.city.id, name: store.city.name, state: store.city.state } : null,
        registeredAddress: store.address,
        registeredLatitude: store.latitude,
        registeredLongitude: store.longitude,
        currentStop: current ? annotateStopStatus(current, now) : null,
        nextStop: next ? annotateStopStatus(next, now) : null,
        distanceKm: Math.round((distanceM / 1000) * 100) / 100,
      };

      if (current) liveNow.push(summary);
      else upcoming.push(summary);
    }

    // Sort by distance, nearest first.
    const byDistance = (a: Summary, b: Summary) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0);
    liveNow.sort(byDistance);
    upcoming.sort(byDistance);

    res.json({ liveNow, upcoming, total: liveNow.length + upcoming.length });
  } catch (err) {
    console.error('[FoodTrucks] nearby failed', err);
    res.status(500).json({ error: 'Failed to load nearby food trucks' });
  }
});

export default router;
