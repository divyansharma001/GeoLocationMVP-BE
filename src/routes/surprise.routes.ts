import { Router } from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { SurpriseService } from '../lib/surprise.service';
import prisma from '../lib/prisma';

const router = Router();
const surpriseService = new SurpriseService();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/surprises/nearby
// Query: lat, lng, radius (km, default 10)
// Returns surprise deal teasers (hints only) near the user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/nearby', protect, async (req: AuthRequest, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat((req.query.radius as string) ?? '10');

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng are required query parameters.' });
    }

    const surprises = await surpriseService.getNearbySurprises(req.user!.id, lat, lng, radius);
    res.json({ surprises, count: surprises.length });
  } catch (err) {
    console.error('[Surprise] nearby error:', err);
    res.status(500).json({ error: 'Failed to fetch nearby surprises.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/surprises/:dealId/reveal
// Body (optional): { lat, lng }
// Validates the trigger condition and reveals the full deal to the user
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:dealId/reveal', protect, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const { lat, lng } = req.body;
    const userId = req.user!.id;

    const result = await surpriseService.revealSurprise(userId, dealId, {
      lat: lat !== undefined ? parseFloat(lat) : undefined,
      lng: lng !== undefined ? parseFloat(lng) : undefined,
    });

    if (!result.success) {
      const status = result.alreadyRevealed ? 200 : 400;
      return res.status(status).json({ error: result.error, alreadyRevealed: result.alreadyRevealed });
    }

    res.json({
      message: 'Surprise revealed!',
      revealId: result.revealId,
      expiresAt: result.expiresAt,
      deal: result.deal,
    });
  } catch (err) {
    console.error('[Surprise] reveal error:', err);
    res.status(500).json({ error: 'Failed to reveal surprise.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/surprises/:dealId
// Returns full deal details — only if the user has an active (unexpired) reveal
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:dealId', protect, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const now = new Date();
    const reveal = await prisma.userSurpriseReveal.findUnique({
      where: { userId_dealId: { userId: req.user!.id, dealId } },
    });

    if (!reveal) return res.status(403).json({ error: 'You have not revealed this surprise yet.' });
    if (reveal.expiresAt <= now) return res.status(410).json({ error: 'Your reveal window has expired.' });

    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        merchant: { select: { id: true, businessName: true, latitude: true, longitude: true, logoUrl: true } },
        category: { select: { name: true, icon: true, color: true } },
        dealType: { select: { name: true } },
      },
    });

    res.json({
      deal,
      reveal: {
        revealedAt: reveal.revealedAt,
        expiresAt: reveal.expiresAt,
        redeemed: reveal.redeemed,
        redeemedAt: reveal.redeemedAt,
      },
    });
  } catch (err) {
    console.error('[Surprise] get deal error:', err);
    res.status(500).json({ error: 'Failed to fetch surprise deal.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/surprises/:dealId/redeem
// Marks a revealed surprise as redeemed within the expiry window
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:dealId/redeem', protect, async (req: AuthRequest, res) => {
  try {
    const dealId = parseInt(req.params.dealId as string);
    if (isNaN(dealId)) return res.status(400).json({ error: 'Invalid dealId.' });

    const result = await surpriseService.redeemSurprise(req.user!.id, dealId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: 'Surprise deal redeemed successfully!' });
  } catch (err) {
    console.error('[Surprise] redeem error:', err);
    res.status(500).json({ error: 'Failed to redeem surprise.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/surprises/my/reveals
// Returns the authenticated user's reveal history (paginated)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/my/reveals', protect, async (req: AuthRequest, res) => {
  try {
    const page = parseInt((req.query.page as string) ?? '1');
    const limit = Math.min(parseInt((req.query.limit as string) ?? '20'), 50);

    const result = await surpriseService.getUserRevealHistory(req.user!.id, page, limit);
    res.json(result);
  } catch (err) {
    console.error('[Surprise] reveal history error:', err);
    res.status(500).json({ error: 'Failed to fetch reveal history.' });
  }
});

export default router;
