import prisma from './prisma';
import { nudgeQueue } from './queue/nudge.queue';
import { NudgeType } from '@prisma/client';
import logger from './logging/logger';

export class NudgeService {
  /**
   * Check if a nudge can be sent to a user (frequency limits)
   */
  async canSendNudge(userId: number, nudgeId: number): Promise<boolean> {
    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId }
    });

    if (!nudge || !nudge.active) {
      return false;
    }

    // Check user preferences
    const prefs = await prisma.userNudgePreferences.findUnique({
      where: { userId }
    });

    if (prefs && !prefs.enabled) {
      return false;
    }

    // Check type-specific preferences
    if (prefs) {
      const typeEnabled = this.isNudgeTypeEnabled(nudge.type, prefs);
      if (!typeEnabled) {
        logger.info(`Nudge type ${nudge.type} disabled for user ${userId}`);
        return false;
      }
    }

    // Check frequency limits
    const lastNudge = await prisma.userNudge.findFirst({
      where: {
        userId,
        nudgeId,
        sentAt: {
          gte: new Date(Date.now() - nudge.cooldownHours * 60 * 60 * 1000)
        }
      },
      orderBy: { sentAt: 'desc' }
    });

    if (lastNudge) {
      logger.info(`Nudge ${nudgeId} blocked by cooldown for user ${userId}`);
      return false;
    }

    // Check time window
    if (nudge.timeWindowStart && nudge.timeWindowEnd) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime < nudge.timeWindowStart || currentTime > nudge.timeWindowEnd) {
        logger.info(`Nudge ${nudgeId} blocked by time window for user ${userId}`);
        return false;
      }
    }

    // Check quiet hours if user has preferences
    if (prefs?.quietHoursStart && prefs?.quietHoursEnd) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime >= prefs.quietHoursStart || currentTime <= prefs.quietHoursEnd) {
        logger.info(`Nudge blocked by user quiet hours for user ${userId}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Send a nudge to a user
   */
  async sendNudge(userId: number, nudgeId: number, contextData?: any): Promise<void> {
    const canSend = await this.canSendNudge(userId, nudgeId);
    if (!canSend) {
      logger.info(`Cannot send nudge ${nudgeId} to user ${userId}`);
      return;
    }

    const nudge = await prisma.nudge.findUnique({
      where: { id: nudgeId }
    });

    if (!nudge) {
      throw new Error(`Nudge ${nudgeId} not found`);
    }

    // Create UserNudge record
    const userNudge = await prisma.userNudge.create({
      data: {
        userId,
        nudgeId,
        contextData,
        delivered: false,
        deliveredVia: 'pending'
      }
    });

    // Add to queue for processing
    await nudgeQueue.add(
      {
        userId,
        nudgeId,
        nudgeType: nudge.type,
        title: nudge.title,
        message: nudge.message,
        contextData,
        userNudgeId: userNudge.id
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    );

    logger.info(`Nudge ${nudgeId} queued for user ${userId}`);
  }

  /**
   * Send nudge to multiple users
   */
  async sendNudgeToMany(userIds: number[], nudgeId: number, contextData?: any): Promise<void> {
    for (const userId of userIds) {
      await this.sendNudge(userId, nudgeId, contextData);
    }
  }

  /**
   * Get user's nudge history
   */
  async getUserNudgeHistory(userId: number, limit = 50) {
    return prisma.userNudge.findMany({
      where: { userId },
      include: { nudge: true },
      orderBy: { sentAt: 'desc' },
      take: limit
    });
  }

  /**
   * Track nudge engagement
   */
  async trackEngagement(userNudgeId: number, action: 'opened' | 'clicked' | 'dismissed') {
    const data: any = { [action]: true };
    if (action === 'opened') data.openedAt = new Date();
    if (action === 'clicked') data.clickedAt = new Date();

    return prisma.userNudge.update({
      where: { id: userNudgeId },
      data
    });
  }

  /**
   * Get nudge analytics
   */
  async getNudgeAnalytics(nudgeId?: number) {
    const where = nudgeId ? { nudgeId } : {};
    
    const [total, delivered, opened, clicked] = await Promise.all([
      prisma.userNudge.count({ where }),
      prisma.userNudge.count({ where: { ...where, delivered: true } }),
      prisma.userNudge.count({ where: { ...where, opened: true } }),
      prisma.userNudge.count({ where: { ...where, clicked: true } })
    ]);

    return {
      total,
      delivered,
      opened,
      clicked,
      deliveryRate: total > 0 ? (delivered / total) * 100 : 0,
      openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
      clickRate: opened > 0 ? (clicked / opened) * 100 : 0
    };
  }

  /**
   * Get or create user preferences
   */
  async getUserPreferences(userId: number) {
    let prefs = await prisma.userNudgePreferences.findUnique({
      where: { userId }
    });

    if (!prefs) {
      prefs = await prisma.userNudgePreferences.create({
        data: { userId }
      });
    }

    return prefs;
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(userId: number, data: any) {
    return prisma.userNudgePreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
  }

  private isNudgeTypeEnabled(type: NudgeType, prefs: any): boolean {
    const mapping: Record<string, boolean> = {
      INACTIVITY: prefs.inactivityEnabled,
      NEARBY_DEAL: prefs.nearbyDealEnabled,
      STREAK_REMINDER: prefs.streakReminderEnabled,
      HAPPY_HOUR_ALERT: prefs.happyHourAlertEnabled,
      WEATHER_BASED: prefs.weatherBasedEnabled
    };
    return mapping[type] ?? true;
  }
}

export const nudgeService = new NudgeService();
