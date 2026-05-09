import prisma from '../lib/prisma';
import type { ScheduledStop, ScheduledStopStatus } from '@prisma/client';

/**
 * Default proximity radius for food-truck check-ins (meters).
 * Trucks park more loosely than fixed venues, so we're more generous than
 * the standard merchant radius.
 */
export const DEFAULT_TRUCK_RADIUS_METERS = 200;

export interface ResolvedScheduleStatus {
  storeId: number;
  current: ScheduledStop | null;
  next: ScheduledStop | null;
}

/**
 * Compute current/next stops for one or many stores at a given moment.
 *
 * "current" = a stop where now ∈ [startsAt, endsAt] AND status is not CANCELLED.
 * "next" = the soonest upcoming stop strictly after `now`, status SCHEDULED or LIVE.
 *
 * The DB stores all timestamps in UTC; comparisons against `now` are timezone-safe.
 */
export async function resolveScheduleStatusFor(
  storeIds: number[],
  now: Date = new Date(),
): Promise<Map<number, ResolvedScheduleStatus>> {
  const result = new Map<number, ResolvedScheduleStatus>();
  if (storeIds.length === 0) return result;

  for (const id of storeIds) {
    result.set(id, { storeId: id, current: null, next: null });
  }

  // Pull all candidate stops in one query: anything that could be "current" or
  // is upcoming. We filter in memory (cheaper than N queries when there are N stores).
  const stops = await prisma.scheduledStop.findMany({
    where: {
      storeId: { in: storeIds },
      status: { in: ['SCHEDULED', 'LIVE'] },
      endsAt: { gte: now }, // covers both "currently active" and "upcoming"
    },
    orderBy: { startsAt: 'asc' },
  });

  for (const stop of stops) {
    const entry = result.get(stop.storeId);
    if (!entry) continue;
    const isCurrent = stop.startsAt <= now && stop.endsAt >= now;
    if (isCurrent && !entry.current) {
      entry.current = stop;
    } else if (!isCurrent && stop.startsAt > now && !entry.next) {
      entry.next = stop;
    }
  }

  return result;
}

export async function resolveScheduleStatusForOne(
  storeId: number,
  now: Date = new Date(),
): Promise<ResolvedScheduleStatus> {
  const map = await resolveScheduleStatusFor([storeId], now);
  return map.get(storeId) ?? { storeId, current: null, next: null };
}

/**
 * Compute the live status field for a stop based on the current time.
 * Used at write time and for computed responses.
 */
export function computeStopStatus(stop: { startsAt: Date; endsAt: Date; status: ScheduledStopStatus }, now: Date = new Date()): ScheduledStopStatus {
  if (stop.status === 'CANCELLED') return 'CANCELLED';
  if (stop.endsAt < now) return 'COMPLETED';
  if (stop.startsAt <= now && stop.endsAt >= now) return 'LIVE';
  return 'SCHEDULED';
}

/**
 * Annotate a stop record with its computed live status (for API responses).
 * The persisted `status` is authoritative for CANCELLED; everything else is computed.
 */
export function annotateStopStatus<T extends { startsAt: Date; endsAt: Date; status: ScheduledStopStatus }>(
  stop: T,
  now: Date = new Date(),
): T {
  return { ...stop, status: computeStopStatus(stop, now) };
}
