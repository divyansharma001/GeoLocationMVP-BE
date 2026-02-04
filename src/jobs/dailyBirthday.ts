// src/jobs/dailyBirthday.ts
// Sends a simple birthday greeting email to users whose birthday (month/day) is today (UTC).
// Assumes User.birthday is stored as a Date (timestamp). Year component is ignored for matching.

import prisma from '../lib/prisma';
import { sendBirthdayEmail } from '../lib/email';
import { getQueue, JobSchedule } from '../lib/queue';

const JOB_NAME = 'daily-birthday';

/**
 * Execute the birthday job for a specific date
 */
export async function runBirthdayJob(forDate = new Date()) {
  const month = forDate.getUTCMonth() + 1; // 1-12
  const day = forDate.getUTCDate(); // 1-31

  // Use raw query to avoid pulling all users. Extract month/day via SQL.
  // Postgres: EXTRACT(MONTH from birthday) and EXTRACT(DAY from birthday)
  const users: Array<{ id: number; email: string; name: string | null }> = await prisma.$queryRawUnsafe(
    `SELECT id, email, name FROM "User" WHERE birthday IS NOT NULL AND EXTRACT(MONTH FROM birthday) = $1 AND EXTRACT(DAY FROM birthday) = $2`,
    month,
    day
  );

  for (const u of users) {
    // Fire & forget each send (no await sequencing needed)
    sendBirthdayEmail({ to: u.email, name: u.name || undefined }).catch(err =>
      console.error('[email] birthday send error userId=' + u.id, err)
    );
  }

  if (users.length) {
    console.log(`[birthday-job]: queued ${users.length} birthday emails for ${month}-${day}`);
  }
}

/**
 * Register and schedule the daily birthday job using the queue abstraction.
 * This allows easy migration to Bull/BullMQ in the future.
 */
export function scheduleDailyBirthdays() {
  const queue = getQueue();

  // Register the job
  queue.register(
    {
      name: JOB_NAME,
      schedule: JobSchedule.DAILY_MIDNIGHT(),
      retry: {
        maxRetries: 3,
        baseDelayMs: 5 * 60 * 1000, // 5 minutes
        exponentialBackoff: true,
      },
      timeout: 5 * 60 * 1000, // 5 minute timeout
    },
    async () => {
      await runBirthdayJob();
    }
  );

  // Schedule the job
  queue.schedule(JOB_NAME);
}

/**
 * Get the status of the birthday job
 */
export function getBirthdayJobStatus() {
  const queue = getQueue();
  return queue.getStatus(JOB_NAME);
}
