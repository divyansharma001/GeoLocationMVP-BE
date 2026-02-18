import prisma from './prisma';
import logger from './logging/logger';

export type InterestEventType =
  | 'DEAL_VIEW'
  | 'MERCHANT_VIEW'
  | 'CHECK_IN'
  | 'DEAL_SAVE'
  | 'REWARD_CLAIM';

/**
 * Fire-and-forget interest event logger.
 * Tracks user interactions with merchants for interest reports.
 */
export function trackInterest(params: {
  merchantId: number;
  userId?: number;
  eventType: InterestEventType;
  dealId?: number;
  venueRewardId?: number;
  metadata?: any;
}) {
  prisma.businessInterestLog
    .create({ data: params })
    .catch((err: unknown) => {
      logger.error('[interest-tracking] Failed to log interest event:', err);
    });
}
