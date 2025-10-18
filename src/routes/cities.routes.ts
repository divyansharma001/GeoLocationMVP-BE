import { Router } from 'express';
import prisma from '../lib/prisma';
import { protect, requireAdmin, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

// GET /api/cities
// Optional query: active=true|false (default true), q=search by name/state
router.get('/cities', async (req, res) => {
  try {
    const { active = 'true', q } = req.query as Record<string, string>;
    const filter: any = {};
    if (active === 'true') filter.active = true;
    if (active === 'false') filter.active = false;
    if (q) {
      filter.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { state: { contains: q, mode: 'insensitive' } },
      ];
    }
  // @ts-ignore - available after Prisma generate
  const cities = await prisma.city.findMany({ where: filter, orderBy: [{ active: 'desc' }, { state: 'asc' }, { name: 'asc' }] });
    res.status(200).json({ cities, total: cities.length });
  } catch (e) {
    console.error('Cities list failed', e);
    res.status(500).json({ error: 'Failed to fetch cities' });
  }
});

// POST /api/cities/toggle
// Body: { cityId: number, active: boolean }
router.post('/cities/toggle', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { cityId, active } = req.body || {};
    if (!cityId || typeof active !== 'boolean') {
      return res.status(400).json({ error: 'cityId (number) and active (boolean) are required' });
    }
  // @ts-ignore - available after Prisma generate
  const updated = await prisma.city.update({ where: { id: Number(cityId) }, data: { active } });
    res.status(200).json({ message: 'City updated', city: updated });
  } catch (e) {
    console.error('City toggle failed', e);
    res.status(500).json({ error: 'Failed to update city' });
  }
});

export default router;

// GET /api/cities/:cityId/stores
// Returns stores in a city, only for approved merchants and active stores by default
router.get('/cities/:cityId/stores', async (req, res) => {
  try {
    const cityId = Number(req.params.cityId);
    const { includeInactive } = req.query as Record<string, string>;
    if (!Number.isFinite(cityId)) return res.status(400).json({ error: 'Invalid cityId' });

    const where: any = { cityId };
    if (includeInactive !== 'true') where.active = true;

    // @ts-ignore - Store model available after Prisma generate
    const stores = await prisma.store.findMany({
      where,
      include: {
        merchant: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            status: true,
            logoUrl: true,
          }
        },
        city: true,
      },
      orderBy: [{ active: 'desc' }, { id: 'asc' }]
    });

    // filter to approved merchants
    const filtered = stores.filter((s: any) => s.merchant?.status === 'APPROVED');
    res.status(200).json({ cityId, total: filtered.length, stores: filtered });
  } catch (e) {
    console.error('City stores list failed', e);
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// GET /api/cities/whitelist
// Public: returns list of active city names only, ordered alphabetically
router.get('/cities/whitelist', async (_req, res) => {
  try {
    // @ts-ignore - available after Prisma generate
    const cities = await prisma.city.findMany({
      where: { active: true },
      select: { name: true },
      orderBy: { name: 'asc' }
    });
    res.status(200).json({ cities: cities.map(c => c.name) });
  } catch (e) {
    console.error('Cities whitelist failed', e);
    res.status(500).json({ error: 'Failed to fetch whitelisted cities' });
  }
});