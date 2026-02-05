import { Router } from 'express';
import { protect, requireAdmin } from '../middleware/auth.middleware';
import { nudgeService } from '../lib/nudge.service';
import prisma from '../lib/prisma';
import logger from '../lib/logging/logger';

const router = Router();

// All admin nudge routes require admin authentication
router.use(protect, requireAdmin);

/**
 * GET /admin/nudges
 * List all nudge templates
 */
router.get('/', async (req, res) => {
  try {
    const nudges = await prisma.nudge.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({
      success: true,
      data: nudges
    });
  } catch (error) {
    logger.error('Error fetching nudges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nudges'
    });
  }
});

/**
 * GET /admin/nudges/:id
 * Get specific nudge details
 */
router.get('/:id', async (req, res) => {
  try {
    const nudgeId = parseInt(req.params.id as string);

    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId },
      include: {
        userNudges: {
          take: 10,
          orderBy: { sentAt: 'desc' }
        }
      }
    });

    if (!nudge) {
      return res.status(404).json({
        success: false,
        message: 'Nudge not found'
      });
    }

    res.json({
      success: true,
      data: nudge
    });
  } catch (error) {
    logger.error('Error fetching nudge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch nudge'
    });
  }
});

/**
 * POST /admin/nudges
 * Create new nudge template
 */
router.post('/', async (req, res) => {
  try {
    const {
      type,
      title,
      message,
      triggerCondition,
      frequency,
      cooldownHours,
      activeStartTime,
      activeEndTime,
      timeWindowStart,
      timeWindowEnd,
      active,
      priority
    } = req.body;

    const userId = (req as any).user.id;

    const nudge = await prisma.nudge.create({
      data: {
        type,
        title,
        message,
        triggerCondition,
        frequency,
        cooldownHours,
        activeStartTime,
        activeEndTime,
        timeWindowStart,
        timeWindowEnd,
        active,
        priority,
        createdBy: userId
      }
    });

    res.status(201).json({
      success: true,
      message: 'Nudge created successfully',
      data: nudge
    });
  } catch (error) {
    logger.error('Error creating nudge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create nudge'
    });
  }
});

/**
 * PUT /admin/nudges/:id
 * Update nudge template
 */
router.put('/:id', async (req, res) => {
  try {
    const nudgeId = parseInt(req.params.id as string);
    const {
      type,
      title,
      message,
      triggerCondition,
      frequency,
      cooldownHours,
      activeStartTime,
      activeEndTime,
      timeWindowStart,
      timeWindowEnd,
      active,
      priority
    } = req.body;

    const nudge = await prisma.nudge.update({
      where: { id: nudgeId },
      data: {
        type,
        title,
        message,
        triggerCondition,
        frequency,
        cooldownHours,
        activeStartTime,
        activeEndTime,
        timeWindowStart,
        timeWindowEnd,
        active,
        priority
      }
    });

    res.json({
      success: true,
      message: 'Nudge updated successfully',
      data: nudge
    });
  } catch (error) {
    logger.error('Error updating nudge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update nudge'
    });
  }
});

/**
 * DELETE /admin/nudges/:id
 * Delete nudge template
 */
router.delete('/:id', async (req, res) => {
  try {
    const nudgeId = parseInt(req.params.id as string);

    await prisma.nudge.delete({
      where: { id: nudgeId }
    });

    res.json({
      success: true,
      message: 'Nudge deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting nudge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete nudge'
    });
  }
});

/**
 * POST /admin/nudges/:id/test/:userId
 * Test send nudge to specific user
 */
router.post('/:id/test/:userId', async (req, res) => {
  try {
    const nudgeId = parseInt(req.params.id as string);
    const userId = parseInt(req.params.userId as string);
    const { contextData } = req.body;

    // Force send (bypass frequency checks for testing)
    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId }
    });

    if (!nudge) {
      return res.status(404).json({
        success: false,
        message: 'Nudge not found'
      });
    }

    await nudgeService.sendNudge(userId, nudgeId, contextData);

    res.json({
      success: true,
      message: 'Test nudge sent successfully'
    });
  } catch (error) {
    logger.error('Error sending test nudge:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test nudge'
    });
  }
});

/**
 * GET /admin/nudges/analytics/overview
 * Get overall nudge analytics
 */
router.get('/analytics/overview', async (req, res) => {
  try {
    const analytics = await nudgeService.getNudgeAnalytics();

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    logger.error('Error fetching nudge analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
});

/**
 * GET /admin/nudges/:id/analytics
 * Get analytics for specific nudge
 */
router.get('/:id/analytics', async (req, res) => {
  try {
    const nudgeId = parseInt(req.params.id as string);

    const analytics = await nudgeService.getNudgeAnalytics(nudgeId);

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    logger.error('Error fetching nudge analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
});

export default router;
