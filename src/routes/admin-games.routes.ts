import express from 'express';
import { protect, AuthRequest, requireAdmin, isApprovedMerchant } from '../middleware/auth.middleware';
import {
  createKittyGame,
  activateGame,
  resolveGame,
  cancelGame,
  getGameAnalytics,
  getActiveGames,
  getGameDetails,
} from '../services/kitty-game.service';
import { refreshBountyQRCode } from '../services/bounty.service';

const router = express.Router();

// ==================== ADMIN GAME MANAGEMENT ====================

// Create a new Kitty Game (admin or merchant)
router.post('/kitty/create', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const createdBy = req.user!.id;
    const merchantId = req.merchant!.id;
    const {
      title,
      entryFee,
      guessWindowStart,
      guessWindowEnd,
      minPlayers,
      maxPlayers,
    } = req.body;

    if (!title || !guessWindowStart || !guessWindowEnd) {
      return res.status(400).json({
        success: false,
        message: 'title, guessWindowStart, and guessWindowEnd are required',
      });
    }

    const game = await createKittyGame({
      merchantId,
      title,
      entryFee: entryFee ? Number(entryFee) : undefined,
      guessWindowStart: new Date(guessWindowStart),
      guessWindowEnd: new Date(guessWindowEnd),
      minPlayers: minPlayers ? Number(minPlayers) : undefined,
      maxPlayers: maxPlayers ? Number(maxPlayers) : undefined,
      createdBy,
    });

    res.status(201).json({ success: true, data: game });
  } catch (error: any) {
    console.error('Error creating kitty game:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Admin: Create a game for any merchant
router.post('/kitty/admin-create', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const createdBy = req.user!.id;
    const {
      merchantId,
      title,
      entryFee,
      guessWindowStart,
      guessWindowEnd,
      minPlayers,
      maxPlayers,
    } = req.body;

    if (!merchantId || !title || !guessWindowStart || !guessWindowEnd) {
      return res.status(400).json({
        success: false,
        message: 'merchantId, title, guessWindowStart, and guessWindowEnd are required',
      });
    }

    const game = await createKittyGame({
      merchantId: Number(merchantId),
      title,
      entryFee: entryFee ? Number(entryFee) : undefined,
      guessWindowStart: new Date(guessWindowStart),
      guessWindowEnd: new Date(guessWindowEnd),
      minPlayers: minPlayers ? Number(minPlayers) : undefined,
      maxPlayers: maxPlayers ? Number(maxPlayers) : undefined,
      createdBy,
    });

    res.status(201).json({ success: true, data: game });
  } catch (error: any) {
    console.error('Error creating kitty game (admin):', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Activate a game
router.patch('/kitty/:gameId/activate', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const game = await activateGame(gameId);

    res.json({ success: true, message: 'Game activated', data: game });
  } catch (error: any) {
    console.error('Error activating game:', error);
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Resolve a game (determine winner)
router.patch('/kitty/:gameId/resolve', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const result = await resolveGame(gameId);

    res.json({ success: true, message: 'Game resolved', data: result });
  } catch (error: any) {
    console.error('Error resolving game:', error);
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Cancel a game
router.patch('/kitty/:gameId/cancel', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const result = await cancelGame(gameId);

    res.json({ success: true, message: 'Game cancelled and refunds issued', data: result });
  } catch (error: any) {
    console.error('Error cancelling game:', error);
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Get all games (admin view)
router.get('/kitty/all', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.query.merchantId ? Number(req.query.merchantId) : undefined;
    const games = await getActiveGames(merchantId);

    res.json({ success: true, data: games });
  } catch (error: any) {
    console.error('Error fetching games:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch games' });
  }
});

// Get game details (admin view - shows secret value)
router.get('/kitty/:gameId', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const gameId = Number(req.params.gameId);
    const game = await getGameDetails(gameId);

    res.json({ success: true, data: game });
  } catch (error: any) {
    console.error('Error fetching game details:', error);
    const status = error.message === 'Game not found' ? 404 : 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// Get game analytics for a merchant
router.get('/kitty/analytics/:merchantId', protect, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const merchantId = Number(req.params.merchantId);
    const analytics = await getGameAnalytics(merchantId);

    res.json({ success: true, data: analytics });
  } catch (error: any) {
    console.error('Error fetching game analytics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch game analytics' });
  }
});

// ==================== BOUNTY MANAGEMENT ====================

// Refresh bounty QR code for a deal
router.post('/bounty/refresh-qr', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant!.id;
    const { dealId } = req.body;

    if (!dealId) {
      return res.status(400).json({ success: false, message: 'dealId is required' });
    }

    const result = await refreshBountyQRCode(Number(dealId), merchantId);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error refreshing bounty QR:', error);
    const status = error.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

export default router;
