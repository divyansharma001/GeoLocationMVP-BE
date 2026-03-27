import express from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { getCheckInLotteryStatusForUser } from '../services/checkin-lottery.service';

const router = express.Router();

// User view of current check-in lottery status
router.get('/current', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const status = await getCheckInLotteryStatusForUser(userId);
    res.json({ success: true, data: status });
  } catch (error: any) {
    console.error('Error fetching check-in lottery status:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch check-in lottery status' });
  }
});

export default router;
