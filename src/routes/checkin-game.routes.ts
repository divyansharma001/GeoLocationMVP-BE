import express from 'express';
import {
  CheckInGameRewardStatus,
  CheckInGameRewardType,
  CheckInGameType,
} from '@prisma/client';
import { protect, AuthRequest, isApprovedMerchant } from '../middleware/auth.middleware';
import {
  getMerchantCheckInGameAnalytics,
  getMerchantCheckInGameConfig,
  getUserCheckInGameSession,
  listUserCheckInGameRewards,
  playUserCheckInGameSession,
  upsertMerchantCheckInGameConfig,
} from '../services/checkin-game.service';

const router = express.Router();

router.get('/merchants/check-in-games/config', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const config = await getMerchantCheckInGameConfig(req.merchant!.id);
    res.json({ success: true, data: config });
  } catch (error: any) {
    console.error('Error loading merchant check-in game config:', error);
    res.status(500).json({ error: 'Failed to load merchant game config' });
  }
});

router.put('/merchants/check-in-games/config', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const {
      isEnabled,
      gameType,
      title,
      subtitle,
      accentColor,
      cooldownMinutes,
      maxPlaysPerCheckIn,
      sessionExpiryMinutes,
      rewardExpiryHours,
      settings,
      rewards,
    } = req.body;

    if (!Object.values(CheckInGameType).includes(gameType)) {
      return res.status(400).json({ error: 'Invalid gameType' });
    }

    if (!Array.isArray(rewards) || rewards.length === 0) {
      return res.status(400).json({ error: 'At least one reward is required' });
    }

    for (const reward of rewards) {
      if (!Object.values(CheckInGameRewardType).includes(reward.rewardType)) {
        return res.status(400).json({ error: `Invalid rewardType: ${reward.rewardType}` });
      }
      if (!reward.label || typeof reward.rewardValue !== 'number') {
        return res.status(400).json({ error: 'Each reward must have a label and numeric rewardValue' });
      }
    }

    const config = await upsertMerchantCheckInGameConfig(req.merchant!.id, {
      isEnabled: Boolean(isEnabled),
      gameType,
      title,
      subtitle,
      accentColor,
      cooldownMinutes: Number(cooldownMinutes ?? 0),
      maxPlaysPerCheckIn: Number(maxPlaysPerCheckIn ?? 1),
      sessionExpiryMinutes: Number(sessionExpiryMinutes ?? 15),
      rewardExpiryHours: Number(rewardExpiryHours ?? 24),
      settings,
      rewards,
    });

    res.json({ success: true, data: config });
  } catch (error: any) {
    console.error('Error saving merchant check-in game config:', error);
    res.status(500).json({ error: error.message || 'Failed to save merchant game config' });
  }
});

router.get('/merchants/check-in-games/analytics', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const analytics = await getMerchantCheckInGameAnalytics(req.merchant!.id);
    res.json({ success: true, data: analytics });
  } catch (error: any) {
    console.error('Error loading merchant check-in game analytics:', error);
    res.status(500).json({ error: 'Failed to load merchant game analytics' });
  }
});

router.get('/check-in-games/session/:sessionToken', protect, async (req: AuthRequest, res) => {
  try {
    const session = await getUserCheckInGameSession(req.user!.id, String(req.params.sessionToken));
    res.json({ success: true, data: session });
  } catch (error: any) {
    console.error('Error loading check-in game session:', error);
    const status = error.message?.includes('expired') ? 410 : 404;
    res.status(status).json({ error: error.message || 'Failed to load game session' });
  }
});

router.post('/check-in-games/session/:sessionToken/play', protect, async (req: AuthRequest, res) => {
  try {
    const result = await playUserCheckInGameSession(req.user!.id, String(req.params.sessionToken));
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error playing check-in game session:', error);
    const status = error.message?.includes('expired') ? 410 : 400;
    res.status(status).json({ error: error.message || 'Failed to play game session' });
  }
});

router.get('/check-in-games/my-rewards', protect, async (req: AuthRequest, res) => {
  try {
    const statusParam = req.query.status as CheckInGameRewardStatus | undefined;
    const rewards = await listUserCheckInGameRewards(
      req.user!.id,
      statusParam && Object.values(CheckInGameRewardStatus).includes(statusParam) ? statusParam : undefined,
    );
    res.json({ success: true, data: rewards });
  } catch (error: any) {
    console.error('Error loading check-in game rewards:', error);
    res.status(500).json({ error: 'Failed to load game rewards' });
  }
});

export default router;
