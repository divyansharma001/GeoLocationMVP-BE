import prisma from '../lib/prisma';
import { haversineMeters } from '../lib/geo';
import logger from '../lib/logging/logger';
import { pushNotificationService, PushNotificationData } from './push-notification.service';
import { CacheTTL, createCacheKey, getOrSetCache } from '../lib/cache';

export interface EventTargetingOptions {
  radiusKm?: number;
  recentDays?: number;
  maxUsers?: number;
  title?: string;
  message?: string;
}

interface TargetCandidate {
  userId: number;
  score: number;
  reasons: string[];
}

const DEFAULT_RADIUS_KM = 10;
const DEFAULT_RECENT_DAYS = 30;
const DEFAULT_MAX_USERS = 250;

export class EventTargetingService {
  async previewAudience(eventId: number, options: EventTargetingOptions = {}) {
    const { context, cacheHit } = await this.buildAudience(eventId, options);
    return {
      event: context.eventSummary,
      audienceSize: context.audience.length,
      sample: context.audience.slice(0, 20),
      filters: context.filters,
      cacheHit,
    };
  }

  async notifyAudience(eventId: number, options: EventTargetingOptions = {}) {
    const { context, cacheHit } = await this.buildAudience(eventId, options);

    const notifications: PushNotificationData[] = context.audience.map(target => ({
      userId: target.userId,
      type: 'event-targeting',
      title: options.title?.trim() || `${context.event.title} is happening nearby`,
      message:
        options.message?.trim() ||
        `A nearby event matched your recent activity: ${context.event.title}. Tap to check details.`,
      data: {
        eventId: context.event.id,
        deepLink: `/events/${context.event.id}`,
        eventTitle: context.event.title,
        startDate: context.event.startDate.toISOString(),
        venueName: context.event.venueName,
        distanceKm: target.distanceKm,
        reasons: target.reasons,
      },
    }));

    await pushNotificationService.sendMany(notifications);

    logger.info(`Queued ${notifications.length} event-targeting notifications for event ${eventId}`);

    return {
      event: context.eventSummary,
      targetedUsers: context.audience.length,
      queuedNotifications: notifications.length,
      filters: context.filters,
      audience: context.audience.slice(0, 20),
      cacheHit,
    };
  }

  private async buildAudience(eventId: number, options: EventTargetingOptions) {
    const radiusKm = Math.min(Math.max(options.radiusKm ?? DEFAULT_RADIUS_KM, 1), 50);
    const recentDays = Math.min(Math.max(options.recentDays ?? DEFAULT_RECENT_DAYS, 1), 90);
    const maxUsers = Math.min(Math.max(options.maxUsers ?? DEFAULT_MAX_USERS, 1), 1000);
    const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);
    const sampleLimit = Math.min(Math.max(maxUsers * 20, 1000), 5000);
    const { value: context, hit } = await getOrSetCache({
      namespace: 'events:targeting',
      key: createCacheKey([eventId, radiusKm, recentDays, maxUsers]),
      ttlMs: CacheTTL.TARGETING_PREVIEW,
      loader: async () => {
        const event = await prisma.event.findUnique({
          where: { id: eventId },
          select: {
            id: true,
            title: true,
            status: true,
            startDate: true,
            venueName: true,
            latitude: true,
            longitude: true,
            cityId: true,
            organizerId: true,
            attendees: {
              select: { userId: true },
            },
          },
        });

        if (!event) {
          throw new Error('Event not found.');
        }

        if (event.latitude == null || event.longitude == null) {
          throw new Error('Event location is required for geo-targeting.');
        }

        const [dealCheckIns, eventCheckIns, savedDeals] = await Promise.all([
          prisma.checkIn.findMany({
            where: {
              createdAt: { gte: cutoff },
            },
            select: {
              userId: true,
              latitude: true,
              longitude: true,
            },
            take: sampleLimit,
          }),
          prisma.eventCheckIn.findMany({
            where: {
              checkedInAt: { gte: cutoff },
              latitude: { not: null },
              longitude: { not: null },
            },
            select: {
              userId: true,
              latitude: true,
              longitude: true,
            },
            take: sampleLimit,
          }),
          prisma.userDeal.findMany({
            where: {
              savedAt: { gte: cutoff },
            },
            select: {
              userId: true,
              deal: {
                select: {
                  merchant: {
                    select: {
                      latitude: true,
                      longitude: true,
                    },
                  },
                },
              },
            },
            take: sampleLimit,
          }),
        ]);

        const candidateMap = new Map<number, TargetCandidate>();
        const attendingUserIds = new Set(event.attendees.map(attendee => attendee.userId));

        for (const checkIn of dealCheckIns) {
      const distanceMeters = haversineMeters(
        event.latitude,
        event.longitude,
        checkIn.latitude,
        checkIn.longitude
      );

      if (distanceMeters <= radiusKm * 1000) {
        this.bumpCandidate(candidateMap, checkIn.userId, 3, 'recent nearby deal check-in');
      }
        }

        for (const checkIn of eventCheckIns) {
      if (checkIn.latitude == null || checkIn.longitude == null) continue;

      const distanceMeters = haversineMeters(
        event.latitude,
        event.longitude,
        checkIn.latitude,
        checkIn.longitude
      );

      if (distanceMeters <= radiusKm * 1000) {
        this.bumpCandidate(candidateMap, checkIn.userId, 4, 'recent nearby event attendance');
      }
        }

        for (const save of savedDeals) {
      const merchantLat = save.deal.merchant.latitude;
      const merchantLng = save.deal.merchant.longitude;
      if (merchantLat == null || merchantLng == null) continue;

      const distanceMeters = haversineMeters(
        event.latitude,
        event.longitude,
        merchantLat,
        merchantLng
      );

      if (distanceMeters <= radiusKm * 1000) {
        this.bumpCandidate(candidateMap, save.userId, 2, 'saved a nearby deal');
      }
        }

        const candidates = Array.from(candidateMap.entries())
          .filter(([userId]) => userId !== event.organizerId && !attendingUserIds.has(userId))
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, maxUsers);

        const users = candidates.length
          ? await prisma.user.findMany({
              where: {
                id: { in: candidates.map(([userId]) => userId) },
              },
              select: {
                id: true,
                name: true,
                nudgePreferences: {
                  select: {
                    enabled: true,
                    surpriseNearbyEnabled: true,
                  },
                },
              },
            })
          : [];

        const userMap = new Map(users.map(user => [user.id, user]));
        const audience = candidates
          .map(([userId, candidate]) => {
            const user = userMap.get(userId);
            if (!user) return null;
            if (user.nudgePreferences && !user.nudgePreferences.enabled) return null;
            if (user.nudgePreferences && !user.nudgePreferences.surpriseNearbyEnabled) return null;

            return {
              userId,
              name: user.name ?? 'User',
              score: candidate.score,
              reasons: candidate.reasons.slice(0, 3),
              distanceKm: radiusKm,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        return {
          event,
          eventSummary: {
            id: event.id,
            title: event.title,
            startDate: event.startDate,
            venueName: event.venueName,
          },
          audience,
          filters: {
            radiusKm,
            recentDays,
            maxUsers,
          },
        };
      },
    });

    return { context, cacheHit: hit };
  }

  private bumpCandidate(
    candidateMap: Map<number, TargetCandidate>,
    userId: number,
    score: number,
    reason: string
  ) {
    const current = candidateMap.get(userId);
    if (!current) {
      candidateMap.set(userId, {
        userId,
        score,
        reasons: [reason],
      });
      return;
    }

    current.score += score;
    if (!current.reasons.includes(reason)) {
      current.reasons.push(reason);
    }
  }
}

export const eventTargetingService = new EventTargetingService();
