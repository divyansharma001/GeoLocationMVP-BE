/**
 * Heist Routes
 * 
 * API endpoints for the heist token feature.
 */

import express from 'express';
import { z } from 'zod';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import {
  getTokenBalance,
  executeHeist,
  getEligibilityBreakdown,
  getHeistHistory,
  getHeistStats,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getAvailableItems,
  getUserInventory,
  purchaseItem,
} from '../lib/heist';
import { HeistStatus, HeistNotificationType } from '@prisma/client';

const router = express.Router();

// Validation schemas
const executeHeistSchema = z.object({
  victimId: z.number().int().positive(),
});

const getHistorySchema = z.object({
  role: z.enum(['attacker', 'victim', 'both']).optional(),
  status: z.nativeEnum(HeistStatus).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const getNotificationsSchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  type: z.nativeEnum(HeistNotificationType).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const markNotificationReadSchema = z.object({
  notificationId: z.number().int().positive().optional(),
  markAll: z.boolean().optional(),
}).refine(
  (data) => data.notificationId || data.markAll,
  'Either notificationId or markAll must be provided'
);

/**
 * GET /heist/tokens
 * Get user's heist token balance
 */
router.get('/tokens', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const balance = await getTokenBalance(userId);

    res.json({
      success: true,
      data: balance,
    });
  } catch (error) {
    console.error('Error fetching token balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch token balance',
    });
  }
});

/**
 * POST /heist/execute
 * Execute a heist against another user
 */
router.post('/execute', protect, async (req: AuthRequest, res) => {
  try {
    // Validate request body
    const validation = executeHeistSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: validation.error.issues,
      });
    }

    const { victimId } = validation.data;
    const attackerId = req.user!.id;

    // Get IP address for audit
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip;

    // Execute heist
    const result = await executeHeist(attackerId, victimId, { ipAddress });

    if (!result.success) {
      // Return appropriate HTTP status based on error code
      const statusCode = getStatusCodeForError(result.code || 'UNKNOWN');
      return res.status(statusCode).json({
        success: false,
        message: result.error,
        code: result.code,
        details: result.details,
      });
    }

    res.json({
      success: true,
      data: {
        heistId: result.heistId,
        pointsStolen: result.pointsStolen,
        attackerPoints: {
          before: result.attackerPointsBefore,
          after: result.attackerPointsAfter,
        },
        victimPoints: {
          before: result.victimPointsBefore,
          after: result.victimPointsAfter,
        },
      },
    });
  } catch (error) {
    console.error('Error executing heist:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to execute heist',
    });
  }
});

/**
 * GET /heist/can-rob/:victimId
 * Check if current user can rob a specific victim
 */
router.get('/can-rob/:victimId', protect, async (req: AuthRequest, res) => {
  try {
    const victimId = parseInt(req.params.victimId, 10);
    if (isNaN(victimId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid victim ID',
      });
    }

    const attackerId = req.user!.id;

    const breakdown = await getEligibilityBreakdown(attackerId, victimId);

    res.json({
      success: true,
      data: {
        eligible: breakdown.eligible,
        checks: breakdown.checks,
        reason: breakdown.failureReason?.reason,
        code: breakdown.failureReason?.code,
        details: breakdown.failureReason?.details,
        pointsWouldSteal: breakdown.pointsWouldSteal,
      },
    });
  } catch (error) {
    console.error('Error checking eligibility:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check eligibility',
    });
  }
});

/**
 * GET /heist/history
 * Get heist history for current user
 */
router.get('/history', protect, async (req: AuthRequest, res) => {
  try {
    // Validate query parameters
    const validation = getHistorySchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: validation.error.issues,
      });
    }

    const userId = req.user!.id;
    const options = validation.data;

    const history = await getHeistHistory(userId, options);

    res.json({
      success: true,
      data: {
        heists: history,
        count: history.length,
      },
    });
  } catch (error) {
    console.error('Error fetching heist history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch heist history',
    });
  }
});

/**
 * GET /heist/stats
 * Get heist statistics for current user
 */
router.get('/stats', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const stats = await getHeistStats(userId);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching heist stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch heist stats',
    });
  }
});

/**
 * GET /heist/notifications
 * Get notifications for current user
 */
router.get('/notifications', protect, async (req: AuthRequest, res) => {
  try {
    // Validate query parameters
    const validation = getNotificationsSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: validation.error.issues,
      });
    }

    const userId = req.user!.id;
    const options = validation.data;

    const [notifications, unreadCount] = await Promise.all([
      getNotifications(userId, options),
      getUnreadCount(userId),
    ]);

    res.json({
      success: true,
      data: {
        notifications,
        count: notifications.length,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
    });
  }
});

/**
 * POST /heist/notifications/read
 * Mark notification(s) as read
 */
router.post('/notifications/read', protect, async (req: AuthRequest, res) => {
  try {
    // Validate request body
    const validation = markNotificationReadSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request',
        errors: validation.error.issues,
      });
    }

    const userId = req.user!.id;
    const { notificationId, markAll } = validation.data;

    if (markAll) {
      const count = await markAllAsRead(userId);
      return res.json({
        success: true,
        data: {
          markedCount: count,
        },
      });
    }

    if (notificationId) {
      const success = await markAsRead(notificationId, userId);
      if (!success) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found or does not belong to you',
        });
      }

      return res.json({
        success: true,
        data: {
          notificationId,
        },
      });
    }

    // Should never reach here due to schema refinement, but just in case
    res.status(400).json({
      success: false,
      message: 'Either notificationId or markAll must be provided',
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
    });
  }
});

/**
 * GET /heist/items
 * Get available items for purchase
 */
router.get('/items', protect, async (req: AuthRequest, res) => {
  try {
    const items = await getAvailableItems();

    res.json({
      success: true,
      data: items,
    });
  } catch (error) {
    console.error('Error fetching available items:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available items',
    });
  }
});

/**
 * GET /heist/items/inventory
 * Get user's inventory
 */
router.get('/items/inventory', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const inventory = await getUserInventory(userId);

    res.json({
      success: true,
      data: inventory,
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inventory',
    });
  }
});

/**
 * POST /heist/items/purchase
 * Purchase an item with coins
 */
router.post('/items/purchase', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { itemId } = req.body;

    if (!itemId || typeof itemId !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Item ID is required and must be a number',
      });
    }

    const result = await purchaseItem(userId, itemId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || 'Failed to purchase item',
      });
    }

    res.json({
      success: true,
      data: {
        inventory: result.inventory,
        message: 'Item purchased successfully',
      },
    });
  } catch (error) {
    console.error('Error purchasing item:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to purchase item',
    });
  }
});

/**
 * Helper: Map error codes to HTTP status codes
 */
function getStatusCodeForError(code: string): number {
  const mapping: Record<string, number> = {
    FEATURE_DISABLED: 503, // Service Unavailable
    INSUFFICIENT_TOKENS: 402, // Payment Required
    COOLDOWN_ACTIVE: 429, // Too Many Requests
    TARGET_PROTECTED: 409, // Conflict
    INVALID_TARGET: 404, // Not Found
    INSUFFICIENT_VICTIM_POINTS: 400, // Bad Request
    DAILY_LIMIT_EXCEEDED: 429, // Too Many Requests
    EXECUTION_ERROR: 500, // Internal Server Error
    SHIELD_BLOCKED: 409, // Conflict
  };

  return mapping[code] || 400; // Default to Bad Request
}

export default router;
