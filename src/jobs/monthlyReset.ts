// src/jobs/monthlyReset.ts
// Resets monthlyPoints for all users at the start of each UTC month.
// Also archives the previous month into an optional historical table in future (placeholder).

import prisma from '../lib/prisma';
import { getQueue, JobSchedule } from '../lib/queue';

const JOB_NAME = 'monthly-reset';

/**
 * Reset monthly points for all users
 */
export async function resetMonthlyPoints() {
  // Single SQL update; could be large but simple. Consider batching if user count huge.
  const result = await prisma.$executeRawUnsafe('UPDATE "User" SET "monthlyPoints" = 0');
  console.log(`[monthly-reset]: Reset monthlyPoints for users. Rows affected: ${result}`);
}

/**
 * Register and schedule the monthly reset job using the queue abstraction.
 * This allows easy migration to Bull/BullMQ in the future.
 */
export function scheduleMonthlyReset() {
  const queue = getQueue();

  // Register the job
  queue.register(
    {
      name: JOB_NAME,
      schedule: JobSchedule.MONTHLY_FIRST(),
      retry: {
        maxRetries: 5,
        baseDelayMs: 60 * 60 * 1000, // 1 hour between retries
        exponentialBackoff: false, // Use fixed delay for this critical job
      },
      timeout: 10 * 60 * 1000, // 10 minute timeout
    },
    async () => {
      await resetMonthlyPoints();
    }
  );

  // Schedule the job
  queue.schedule(JOB_NAME);
}

/**
 * Get the status of the monthly reset job
 */
export function getMonthlyResetJobStatus() {
  const queue = getQueue();
  return queue.getStatus(JOB_NAME);
}
