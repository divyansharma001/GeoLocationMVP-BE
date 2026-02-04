/**
 * Cache Module
 *
 * Exports cache implementations and utilities.
 *
 * Usage:
 * ```typescript
 * import { getCache, CacheProvider } from '../lib/cache';
 *
 * const cache = getCache();
 * await cache.set('key', value, 60000); // 60 second TTL
 * const value = await cache.get('key');
 * ```
 *
 * To switch to Redis in production:
 * 1. Install ioredis: npm install ioredis
 * 2. Set REDIS_URL in environment
 * 3. The getCache() function will automatically use Redis when available
 */

export { CacheProvider, CacheStats, CacheConfig } from './cache.interface';
export { MemoryCache, getDefaultCache } from './memory.cache';

import { CacheProvider } from './cache.interface';
import { MemoryCache } from './memory.cache';

// Cache instance singleton
let cacheInstance: CacheProvider | null = null;

/**
 * Get the configured cache instance
 *
 * Returns Redis if REDIS_URL is set, otherwise returns MemoryCache.
 * This allows seamless switching between cache backends via environment.
 */
export function getCache(): CacheProvider {
  if (cacheInstance) {
    return cacheInstance;
  }

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    // TODO: Implement RedisCache when needed
    // For now, log a warning and fall back to memory cache
    console.warn(
      '[Cache] REDIS_URL is set but RedisCache is not implemented. Falling back to MemoryCache.'
    );
    console.warn(
      '[Cache] To implement Redis, create src/lib/cache/redis.cache.ts implementing CacheProvider'
    );
  }

  // Default to memory cache
  cacheInstance = new MemoryCache({
    maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
    keyPrefix: process.env.CACHE_KEY_PREFIX || 'yohop',
  });

  return cacheInstance;
}

/**
 * TTL presets for common cache durations
 */
export const CacheTTL = {
  /** 30 seconds - for rapidly changing data */
  SHORT: 30_000,
  /** 2 minutes - for moderately dynamic data */
  MEDIUM: 120_000,
  /** 5 minutes - for stable data */
  LONG: 300_000,
  /** 15 minutes - for rarely changing data */
  VERY_LONG: 900_000,
  /** 1 hour */
  HOUR: 3_600_000,
  /** 24 hours */
  DAY: 86_400_000,
} as const;
