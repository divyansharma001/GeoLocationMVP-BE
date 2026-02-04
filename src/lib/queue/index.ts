/**
 * Job Queue Module
 *
 * Exports queue implementations and utilities.
 *
 * Usage:
 * ```typescript
 * import { getQueue, JobOptions } from '../lib/queue';
 *
 * // Register a job
 * const queue = getQueue();
 * queue.register({
 *   name: 'daily-report',
 *   schedule: {
 *     type: 'interval',
 *     intervalMs: 24 * 60 * 60 * 1000, // 24 hours
 *   },
 *   retry: { maxRetries: 3, baseDelayMs: 60000 },
 * }, async () => {
 *   // Job logic here
 * });
 *
 * // Start the job
 * await queue.schedule('daily-report');
 * ```
 *
 * To switch to Bull in production:
 * 1. Install bull: npm install bull
 * 2. Set REDIS_URL in environment
 * 3. Implement BullQueue in src/lib/queue/bull.queue.ts
 * 4. The getQueue() function will automatically use Bull when available
 */

export {
  QueueProvider,
  JobHandler,
  JobOptions,
  JobStatus,
  QueueStats,
  ScheduleConfig,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './queue.interface';

export { MemoryQueue, getDefaultQueue } from './memory.queue';

import { QueueProvider } from './queue.interface';
import { MemoryQueue } from './memory.queue';

// Queue instance singleton
let queueInstance: QueueProvider | null = null;

/**
 * Get the configured queue instance
 *
 * Returns Bull if REDIS_URL is set and BullQueue is implemented,
 * otherwise returns MemoryQueue.
 */
export function getQueue(): QueueProvider {
  if (queueInstance) {
    return queueInstance;
  }

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // TODO: Implement BullQueue when needed
    // For now, log a warning and fall back to memory queue
    console.warn(
      '[Queue] REDIS_URL is set but BullQueue is not implemented. Falling back to MemoryQueue.'
    );
    console.warn(
      '[Queue] To implement Bull, create src/lib/queue/bull.queue.ts implementing QueueProvider'
    );
  }

  // Default to memory queue
  queueInstance = new MemoryQueue();
  return queueInstance;
}

/**
 * Schedule presets for common job patterns
 */
export const JobSchedule = {
  /** Run at next UTC midnight, then every 24 hours */
  DAILY_MIDNIGHT: (now = new Date()) => ({
    type: 'cron' as const,
    getNextRunMs: () => {
      const current = now;
      const y = current.getUTCFullYear();
      const m = current.getUTCMonth();
      const d = current.getUTCDate();
      const next = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 50));
      return Math.min(next.getTime() - current.getTime(), 24 * 24 * 60 * 60 * 1000);
    },
  }),

  /** Run at first of next month UTC */
  MONTHLY_FIRST: (now = new Date()) => ({
    type: 'cron' as const,
    getNextRunMs: () => {
      const current = now;
      const year = current.getUTCFullYear();
      const month = current.getUTCMonth();
      const firstNext = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
      return Math.min(firstNext.getTime() - current.getTime(), 24 * 24 * 60 * 60 * 1000);
    },
  }),

  /** Run every N milliseconds */
  EVERY: (intervalMs: number) => ({
    type: 'interval' as const,
    intervalMs,
  }),

  /** Run once after N milliseconds */
  ONCE_AFTER: (delayMs: number) => ({
    type: 'once' as const,
    delayMs,
  }),
} as const;
