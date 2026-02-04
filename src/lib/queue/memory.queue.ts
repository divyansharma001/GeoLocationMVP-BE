/**
 * Memory Queue Implementation
 *
 * Uses setTimeout-based scheduling for single-instance deployments.
 * Provides the same interface as Bull/BullMQ for easy migration.
 *
 * Limitations:
 * - Jobs are lost on server restart (no persistence)
 * - Only works for single-instance deployments
 * - No distributed locking
 *
 * For production with multiple instances, implement BullQueue with Redis.
 */

import {
  QueueProvider,
  JobHandler,
  JobOptions,
  JobStatus,
  QueueStats,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './queue.interface';

interface RegisteredJob {
  options: JobOptions;
  handler: JobHandler<any>;
  timer: NodeJS.Timeout | null;
  status: JobStatus;
  retryCount: number;
}

export class MemoryQueue implements QueueProvider {
  private jobs = new Map<string, RegisteredJob>();
  private isShuttingDown = false;

  constructor() {
    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  register<T>(options: JobOptions, handler: JobHandler<T>): void {
    if (this.jobs.has(options.name)) {
      console.warn(`[Queue] Job "${options.name}" already registered. Skipping.`);
      return;
    }

    const job: RegisteredJob = {
      options,
      handler,
      timer: null,
      status: {
        name: options.name,
        status: 'pending',
        runCount: 0,
        failureCount: 0,
      },
      retryCount: 0,
    };

    this.jobs.set(options.name, job);
    console.log(`[Queue] Registered job: ${options.name}`);
  }

  async schedule<T>(name: string, data?: T): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found. Register it first.`);
    }

    if (this.isShuttingDown) {
      console.warn(`[Queue] Cannot schedule "${name}" - queue is shutting down.`);
      return;
    }

    const { schedule } = job.options;
    if (!schedule) {
      // No schedule config - run immediately
      await this.runNow(name, data);
      return;
    }

    let delayMs: number;

    switch (schedule.type) {
      case 'interval':
        delayMs = schedule.intervalMs || 60_000;
        break;
      case 'delayed':
      case 'once':
        delayMs = schedule.delayMs || 0;
        break;
      case 'cron':
        // For cron, use custom function if provided, otherwise fall back to interval
        if (schedule.getNextRunMs) {
          delayMs = schedule.getNextRunMs();
        } else {
          console.warn(`[Queue] Cron scheduling requires getNextRunMs function. Falling back to 1 hour interval.`);
          delayMs = 60 * 60 * 1000;
        }
        break;
      default:
        delayMs = schedule.getNextRunMs?.() || 60_000;
    }

    // Cap at maximum safe timeout value (24 days)
    const MAX_SAFE_TIMEOUT = 24 * 24 * 60 * 60 * 1000;
    delayMs = Math.min(delayMs, MAX_SAFE_TIMEOUT);

    job.status.status = 'scheduled';
    job.status.nextRun = new Date(Date.now() + delayMs);

    console.log(`[Queue] Scheduling "${name}" to run in ${Math.round(delayMs / 1000 / 60)} minutes`);

    job.timer = setTimeout(async () => {
      await this.executeJob(job, data);

      // Reschedule if it's a recurring job
      if (schedule.type === 'interval' || schedule.type === 'cron') {
        if (!this.isShuttingDown) {
          await this.schedule(name, data);
        }
      }
    }, delayMs);

    // Don't prevent process from exiting
    job.timer.unref();
  }

  async runNow<T>(name: string, data?: T): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found. Register it first.`);
    }

    await this.executeJob(job, data);
  }

  private async executeJob<T>(job: RegisteredJob, data?: T): Promise<void> {
    const { options, handler } = job;
    const startTime = Date.now();

    job.status.status = 'running';
    job.status.lastRun = new Date();

    try {
      // Apply timeout if configured
      const timeout = options.timeout;
      if (timeout) {
        await Promise.race([
          handler(data),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Job "${options.name}" timed out after ${timeout}ms`)), timeout)
          ),
        ]);
      } else {
        await handler(data);
      }

      const duration = Date.now() - startTime;
      job.status.status = 'completed';
      job.status.runCount++;
      job.retryCount = 0; // Reset retry count on success
      console.log(`[Queue] Job "${options.name}" completed in ${duration}ms`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      job.status.status = 'failed';
      job.status.failureCount++;
      job.status.lastError = errorMessage;
      console.error(`[Queue] Job "${options.name}" failed:`, errorMessage);

      // Handle retry logic
      await this.handleRetry(job, data, error);
    }
  }

  private async handleRetry<T>(job: RegisteredJob, data: T | undefined, error: unknown): Promise<void> {
    const retryConfig: RetryConfig = job.options.retry || DEFAULT_RETRY_CONFIG;

    if (job.retryCount < retryConfig.maxRetries) {
      job.retryCount++;

      let delayMs = retryConfig.baseDelayMs;
      if (retryConfig.exponentialBackoff) {
        delayMs = retryConfig.baseDelayMs * Math.pow(2, job.retryCount - 1);
      }

      // Cap retry delay
      const MAX_RETRY_DELAY = 60 * 60 * 1000; // 1 hour max
      delayMs = Math.min(delayMs, MAX_RETRY_DELAY);

      console.log(`[Queue] Retrying "${job.options.name}" (attempt ${job.retryCount}/${retryConfig.maxRetries}) in ${Math.round(delayMs / 1000)} seconds`);

      job.status.status = 'scheduled';
      job.status.nextRun = new Date(Date.now() + delayMs);

      job.timer = setTimeout(async () => {
        await this.executeJob(job, data);
      }, delayMs);

      job.timer.unref();
    } else {
      console.error(`[Queue] Job "${job.options.name}" failed after ${retryConfig.maxRetries} retries. Giving up.`);
    }
  }

  async cancel(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      return;
    }

    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }

    job.status.status = 'pending';
    job.status.nextRun = undefined;
    console.log(`[Queue] Cancelled job: ${name}`);
  }

  getStatus(name: string): JobStatus | null {
    const job = this.jobs.get(name);
    return job ? { ...job.status } : null;
  }

  getAllStatuses(): JobStatus[] {
    return Array.from(this.jobs.values()).map(job => ({ ...job.status }));
  }

  getStats(): QueueStats {
    const statuses = this.getAllStatuses();
    return {
      activeJobs: statuses.filter(s => s.status === 'running').length,
      scheduledJobs: statuses.filter(s => s.status === 'scheduled').length,
      completedJobs: statuses.reduce((sum, s) => sum + s.runCount, 0),
      failedJobs: statuses.reduce((sum, s) => sum + s.failureCount, 0),
    };
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    console.log('[Queue] Shutting down...');

    // Cancel all scheduled jobs
    for (const [name, job] of this.jobs) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
        console.log(`[Queue] Cancelled scheduled job: ${name}`);
      }
    }

    console.log('[Queue] Shutdown complete.');
  }

  async isHealthy(): Promise<boolean> {
    return !this.isShuttingDown;
  }
}

// Singleton instance
let queueInstance: MemoryQueue | null = null;

export function getDefaultQueue(): MemoryQueue {
  if (!queueInstance) {
    queueInstance = new MemoryQueue();
  }
  return queueInstance;
}
