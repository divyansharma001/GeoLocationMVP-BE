/**
 * Heist Notifications
 * 
 * Functions for creating and managing heist-related notifications.
 */

import { PrismaClient, HeistNotificationType } from '@prisma/client';

const prisma = new PrismaClient();

export interface NotificationMetadata {
  attackerId?: string;
  attackerName?: string;
  victimId?: string;
  victimName?: string;
  pointsStolen?: number;
  tokensEarned?: number;
  referralName?: string;
  heistId?: string;
  [key: string]: any;
}

/**
 * Create a heist success notification for the attacker
 */
export async function createHeistSuccessNotification(
  attackerId: number,
  victimId: number,
  victimName: string,
  pointsStolen: number,
  heistId: number,
  tx?: PrismaClient
): Promise<void> {
  const client = tx || prisma;

  await client.heistNotification.create({
    data: {
      userId: attackerId,
      heistId,
      type: HeistNotificationType.HEIST_SUCCESS,
      message: `Heist successful! You stole ${pointsStolen} points from ${victimName}`,
      metadata: {
        victimId,
        victimName,
        pointsStolen,
      },
      read: false,
      emailSent: false,
    },
  });
}

/**
 * Create a heist victim notification
 */
export async function createHeistVictimNotification(
  victimId: number,
  attackerId: number,
  attackerName: string,
  pointsStolen: number,
  heistId: number,
  tx?: PrismaClient
): Promise<void> {
  const client = tx || prisma;

  await client.heistNotification.create({
    data: {
      userId: victimId,
      heistId,
      type: HeistNotificationType.HEIST_VICTIM,
      message: `${attackerName} robbed you and stole ${pointsStolen} points!`,
      metadata: {
        attackerId,
        attackerName,
        pointsStolen,
      },
      read: false,
      emailSent: false,
    },
  });
}

/**
 * Create a token earned notification
 */
export async function createTokenEarnedNotification(
  userId: number,
  tokensEarned: number,
  referralName: string,
  tx?: PrismaClient
): Promise<void> {
  const client = tx || prisma;

  await client.heistNotification.create({
    data: {
      userId,
      type: HeistNotificationType.TOKEN_EARNED,
      message: `You earned ${tokensEarned} heist token(s)! ${referralName} signed up using your referral code.`,
      metadata: {
        tokensEarned,
        referralName,
      },
      read: false,
      emailSent: false,
    },
  });
}

/**
 * Get notifications for a user
 */
export async function getNotifications(
  userId: number,
  options: {
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
    type?: HeistNotificationType;
  } = {}
): Promise<Array<{
  id: number;
  type: HeistNotificationType;
  message: string;
  metadata: any;
  read: boolean;
  createdAt: Date;
  heistId: number | null;
}>> {
  const where: any = { userId };

  if (options.unreadOnly) {
    where.read = false;
  }

  if (options.type) {
    where.type = options.type;
  }

  const notifications = await prisma.heistNotification.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
    take: options.limit || 50,
    skip: options.offset || 0,
    select: {
      id: true,
      type: true,
      message: true,
      metadata: true,
      read: true,
      createdAt: true,
      heistId: true,
    },
  });

  return notifications;
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userId: number): Promise<number> {
  return prisma.heistNotification.count({
    where: {
      userId,
      read: false,
    },
  });
}

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: number, userId: number): Promise<boolean> {
  try {
    await prisma.heistNotification.updateMany({
      where: {
        id: notificationId,
        userId, // Ensure user owns this notification
      },
      data: {
        read: true,
      },
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: number): Promise<number> {
  const result = await prisma.heistNotification.updateMany({
    where: {
      userId,
      read: false,
    },
    data: {
      read: true,
    },
  });

  return result.count;
}

/**
 * Delete old read notifications (cleanup)
 * Deletes notifications older than specified days
 */
export async function deleteOldNotifications(daysOld: number = 90): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await prisma.heistNotification.deleteMany({
    where: {
      read: true,
      createdAt: {
        lt: cutoffDate,
      },
    },
  });

  return result.count;
}
