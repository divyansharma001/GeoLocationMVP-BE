/**
 * Cache Provider Interface
 *
 * This abstraction allows swapping between different cache implementations
 * (in-memory, Redis, Memcached, etc.) without changing consuming code.
 *
 * Usage:
 * - For local development: Use MemoryCache (default)
 * - For production with multiple instances: Implement RedisCache
 */

export interface CacheProvider {
  /**
   * Get a value from the cache
   * @param key - The cache key
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in the cache
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttlMs - Time to live in milliseconds
   */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;

  /**
   * Delete a specific key from the cache
   * @param key - The cache key to delete
   */
  delete(key: string): Promise<void>;

  /**
   * Delete all keys matching a pattern
   * @param pattern - Pattern to match (e.g., "leaderboard:*")
   */
  deletePattern(pattern: string): Promise<void>;

  /**
   * Clear all cached data
   */
  clear(): Promise<void>;

  /**
   * Get cache statistics
   */
  getStats(): Promise<CacheStats>;

  /**
   * Check if cache is healthy/connected
   */
  isHealthy(): Promise<boolean>;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
}

export interface CacheConfig {
  /** Maximum number of entries (for memory cache) */
  maxSize?: number;
  /** Default TTL in milliseconds */
  defaultTtlMs?: number;
  /** Redis connection URL (for Redis cache) */
  redisUrl?: string;
  /** Key prefix for namespacing */
  keyPrefix?: string;
}
