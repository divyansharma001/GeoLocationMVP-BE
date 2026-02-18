import { Router } from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { nudgeService } from '../lib/nudge.service';
import logger from '../lib/logging/logger';

const router = Router();

/**
 * GET /api/nudges/history
 * Get user's nudge history
 */
router.get('/history', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const limit = parseInt(req.query.limit as string) || 50;

    const history = await nudgeService.getUserNudgeHistory(userId, limit);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    logger.error('Error fetching nudge history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nudge history'
    });
  }
});

/**
 * GET /api/nudges/preferences
 * Get user's nudge preferences
 */
router.get('/preferences', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const preferences = await nudgeService.getUserPreferences(userId);

    res.json({
      success: true,
      data: preferences
    });
  } catch (error) {
    logger.error('Error fetching nudge preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch preferences'
    });
  }
});

/**
 * PUT /api/nudges/preferences
 * Update user's nudge preferences
 */
router.put('/preferences', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const {
      enabled,
      inactivityEnabled,
      nearbyDealEnabled,
      streakReminderEnabled,
      happyHourAlertEnabled,
      weatherBasedEnabled,
      quietHoursStart,
      quietHoursEnd
    } = req.body;

    const preferences = await nudgeService.updateUserPreferences(userId, {
      enabled,
      inactivityEnabled,
      nearbyDealEnabled,
      streakReminderEnabled,
      happyHourAlertEnabled,
      weatherBasedEnabled,
      quietHoursStart,
      quietHoursEnd
    });

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: preferences
    });
  } catch (error) {
    logger.error('Error updating nudge preferences:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update preferences'
    });
  }
});

/**
 * POST /api/nudges/:id/engage
 * Track nudge engagement (opened, clicked, dismissed)
 */
router.post('/:id/engage', protect, async (req: AuthRequest, res) => {
  try {
    const userNudgeId = parseInt(req.params.id as string);
    const { action } = req.body;

    if (!['opened', 'clicked', 'dismissed'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be: opened, clicked, or dismissed'
      });
    }

    const userNudge = await nudgeService.getUserNudgeById(userNudgeId);
    if (!userNudge || userNudge.userId !== req.user!.id) {
      return res.status(404).json({
        success: false,
        message: 'Nudge not found'
      });
    }

    await nudgeService.trackEngagement(userNudgeId, action);

    res.json({
      success: true,
      message: 'Engagement tracked successfully'
    });
  } catch (error) {
    logger.error('Error tracking nudge engagement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track engagement'
    });
  }
});

export default router;
