import Queue from 'bull';
import { getIO } from '../lib/websocket/socket.server';
import redis from '../lib/redis';
import logger from '../lib/logging/logger';
import prisma from '../lib/prisma';

export interface PushNotificationData {
  userId: number;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

interface PushNotificationEnvelope extends PushNotificationData {
  timestamp: string;
}

const PENDING_TTL_SECONDS = 60 * 60 * 24 * 3;
const PENDING_MAX_PER_USER = 50;

export const pushNotificationQueue = new Queue<PushNotificationData>('push-notifications', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
});

function getPendingKey(userId: number): string {
  return `user:${userId}:pending_notifications`;
}

function getCurrentTimeHHMM(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

function isInQuietHours(currentTime: string, start: string, end: string): boolean {
  const spansMidnight = start > end;
  return spansMidnight
    ? currentTime >= start || currentTime <= end
    : currentTime >= start && currentTime <= end;
}

async function canDeliverNow(userId: number): Promise<{ allowed: boolean; reason?: string }> {
  const prefs = await prisma.userNudgePreferences.findUnique({
    where: { userId },
    select: {
      enabled: true,
      surpriseNearbyEnabled: true,
      quietHoursStart: true,
      quietHoursEnd: true,
    },
  });

  if (prefs && !prefs.enabled) {
    return { allowed: false, reason: 'notifications_disabled' };
  }

  // Reuse existing location-based notification preference until a dedicated event preference exists.
  if (prefs && prefs.surpriseNearbyEnabled === false) {
    return { allowed: false, reason: 'location_notifications_disabled' };
  }

  if (prefs?.quietHoursStart && prefs?.quietHoursEnd) {
    const currentTime = getCurrentTimeHHMM();
    if (isInQuietHours(currentTime, prefs.quietHoursStart, prefs.quietHoursEnd)) {
      return { allowed: false, reason: 'quiet_hours' };
    }
  }

  return { allowed: true };
}

async function enqueuePendingNotification(payload: PushNotificationEnvelope): Promise<void> {
  const key = getPendingKey(payload.userId);
  await redis.lpush(key, JSON.stringify(payload));
  await redis.ltrim(key, 0, PENDING_MAX_PER_USER - 1);
  await redis.expire(key, PENDING_TTL_SECONDS);
}

pushNotificationQueue.process(async (job) => {
  const payload = job.data;
  const envelope: PushNotificationEnvelope = {
    ...payload,
    timestamp: new Date().toISOString(),
  };

  const policy = await canDeliverNow(payload.userId);
  if (!policy.allowed) {
    logger.info(`Skipping push notification for user ${payload.userId}: ${policy.reason}`);
    return { delivered: false, skipped: policy.reason };
  }

  try {
    const isOnline = await redis.sismember('online_users', payload.userId.toString());

    if (isOnline) {
      const io = getIO();
      io.to(`user:${payload.userId}`).emit('notification', envelope);
      logger.info(`Push notification sent via WebSocket to user ${payload.userId}`);
      return { delivered: true, via: 'websocket' };
    }

    await enqueuePendingNotification(envelope);
    logger.info(`Push notification queued as pending for offline user ${payload.userId}`);
    return { delivered: true, via: 'pending' };
  } catch (error) {
    logger.error(`Failed to process push notification for user ${payload.userId}:`, error);
    throw error;
  }
});

pushNotificationQueue.on('failed', (job, err) => {
  logger.error(`Push notification job ${job.id} failed:`, err);
});

export class PushNotificationService {
  async send(notification: PushNotificationData): Promise<void> {
    await pushNotificationQueue.add(notification, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  async sendMany(notifications: PushNotificationData[]): Promise<void> {
    for (const notification of notifications) {
      await this.send(notification);
    }
  }

  async flushPendingForUser(userId: number): Promise<number> {
    const key = getPendingKey(userId);
    const pending = await redis.lrange(key, 0, -1);

    if (!pending.length) {
      return 0;
    }

    const io = getIO();
    const messages = pending
      .map(item => {
        try {
          return JSON.parse(item) as PushNotificationEnvelope;
        } catch {
          return null;
        }
      })
      .filter((item): item is PushNotificationEnvelope => item !== null)
      .reverse();

    for (const message of messages) {
      io.to(`user:${userId}`).emit('notification', message);
    }

    await redis.del(key);
    logger.info(`Flushed ${messages.length} pending notifications to user ${userId}`);
    return messages.length;
  }
}

export const pushNotificationService = new PushNotificationService();
