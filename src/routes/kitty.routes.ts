import express from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import {
  submitGuess,
  getActiveGames,
  getGameDetails,
} from '../services/kitty-game.service';
import {
  startBountyProgress,
  recordBountyReferral,
  verifyBountyScan,
  getUserBountyDashboard,
} from '../services/bounty.service';

const router = express.Router();

// ==================== KITTY GAME ROUTES ====================

// Get all active games (optionally filter by merchant)
router.get('/games', protect, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.query.merchantId ? Number(req.query.merchantId) : undefined;
    const games = await getActiveGames(merchantId);

    res.json({ success: true, data: games });
  } catch (error: any) {
    console.error('Error fetching active games:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch active games' });
  }
});

// Get game details
router.get('/games/:gameId', protect, async (req: AuthRequest, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const userId = req.user!.id;
    const game = await getGameDetails(gameId, userId);

    res.json({ success: true, data: game });
  } catch (error: any) {
    console.error('Error fetching game details:', error);
    const status = error.message === 'Game not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Submit a guess
router.post('/games/:gameId/guess', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const gameId = Number(req.params.gameId);
    const { guessValue } = req.body;

    if (guessValue === undefined || guessValue === null) {
      return res.status(400).json({
        success: false,
        message: 'guessValue is required (number between 1-1000)',
      });
    }

    const result = await submitGuess(userId, gameId, Number(guessValue));
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error submitting guess:', error);
    const status = error.message.includes('not found')
      ? 404
      : error.message.includes('already') || error.message.includes('Insufficient')
        ? 400
        : 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// ==================== BOUNTY ROUTES ====================

// Get user's bounty dashboard
router.get('/bounty/dashboard', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const dashboard = await getUserBountyDashboard(userId);

    res.json({ success: true, data: dashboard });
  } catch (error: any) {
    console.error('Error fetching bounty dashboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch bounty dashboard' });
  }
});

// Start/join a bounty deal
router.post('/bounty/start', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({ success: false, message: 'dealId is required' });
    }

    const result = await startBountyProgress(userId, Number(dealId));
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error starting bounty:', error);
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Record a bounty referral
router.post('/bounty/referral', protect, async (req: AuthRequest, res) => {
  try {
    const referrerId = req.user!.id;
    const { referredUserId, dealId } = req.body;

    if (!referredUserId || !dealId) {
      return res.status(400).json({
        success: false,
        message: 'referredUserId and dealId are required',
      });
    }

    const result = await recordBountyReferral(
      referrerId,
      Number(referredUserId),
      Number(dealId)
    );

    res.json({
      success: true,
      message: 'Referral recorded successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('Error recording bounty referral:', error);
    const status = error.message.includes('yourself') ? 400 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Verify a bounty QR code scan
router.post('/bounty/verify-qr', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { qrCodeData } = req.body;

    if (!qrCodeData) {
      return res.status(400).json({ success: false, message: 'qrCodeData is required' });
    }

    const result = await verifyBountyScan(userId, qrCodeData);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error verifying bounty QR:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
