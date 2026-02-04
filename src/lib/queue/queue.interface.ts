/**
 * Job Queue Interface
 *
 * This abstraction allows swapping between different queue implementations
 * (in-memory setTimeout, Bull, BullMQ, etc.) without changing consuming code.
 *
 * Usage:
 * - For local development / single instance: Use MemoryQueue (default)
 * - For production with multiple instances: Implement BullQueue with Redis
 */

export interface JobHandler<T = unknown> {
  (data: T): Promise<void>;
}

export interface JobOptions {
  /** Job name for identification */
  name: string;
  /** Cron expression or schedule config */
  schedule?: ScheduleConfig;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Job timeout in milliseconds */
  timeout?: number;
}

export interface ScheduleConfig {
  /** Type of schedule */
  type: 'cron' | 'interval' | 'delayed' | 'once';
  /** Cron expression (for type: 'cron') */
  cron?: string;
  /** Interval in milliseconds (for type: 'interval') */
  intervalMs?: number;
  /** Delay in milliseconds (for type: 'delayed' or 'once') */
  delayMs?: number;
  /** Function to calculate next run time (for custom scheduling) */
  getNextRunMs?: () => number;
}

export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay between retries in milliseconds */
  baseDelayMs: number;
  /** Whether to use exponential backoff */
  exponentialBackoff?: boolean;
}

export interface JobStatus {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled';
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  failureCount: number;
  lastError?: string;
}

export interface QueueStats {
  activeJobs: number;
  scheduledJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface QueueProvider {
  /**
   * Register a job with its handler
   * @param options - Job configuration
   * @param handler - Function to execute when job runs
   */
  register<T>(options: JobOptions, handler: JobHandler<T>): void;

  /**
   * Schedule a registered job
   * @param name - Name of the registered job
   * @param data - Data to pass to the handler
   */
  schedule<T>(name: string, data?: T): Promise<void>;

  /**
   * Run a job immediately (bypassing schedule)
   * @param name - Name of the registered job
   * @param data - Data to pass to the handler
   */
  runNow<T>(name: string, data?: T): Promise<void>;

  /**
   * Cancel a scheduled job
   * @param name - Name of the job to cancel
   */
  cancel(name: string): Promise<void>;

  /**
   * Get status of a job
   * @param name - Name of the job
   */
  getStatus(name: string): JobStatus | null;

  /**
   * Get all job statuses
   */
  getAllStatuses(): JobStatus[];

  /**
   * Get queue statistics
   */
  getStats(): QueueStats;

  /**
   * Gracefully shutdown the queue
   */
  shutdown(): Promise<void>;

  /**
   * Check if queue is healthy/connected
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 60_000, // 1 minute
  exponentialBackoff: true,
};
