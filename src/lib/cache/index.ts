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
export { RedisCache } from './redis.cache';
export { getOrSetCache, invalidateCacheKey, invalidateCachePattern, createCacheKey } from './utils';

import { CacheProvider } from './cache.interface';
import { MemoryCache } from './memory.cache';
import { RedisCache } from './redis.cache';

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

  const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;

  if (redisUrl) {
    cacheInstance = new RedisCache({
      maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000', 10),
      keyPrefix: process.env.CACHE_KEY_PREFIX || 'yohop',
    });
    return cacheInstance;
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
  PUBLIC_LIST: parseInt(process.env.CACHE_TTL_PUBLIC_LIST_MS || '60000', 10),
  DETAIL: parseInt(process.env.CACHE_TTL_DETAIL_MS || '120000', 10),
  EXTERNAL_API: parseInt(process.env.CACHE_TTL_EXTERNAL_API_MS || '180000', 10),
  TARGETING_PREVIEW: parseInt(process.env.CACHE_TTL_TARGETING_PREVIEW_MS || '120000', 10),
  MERCHANT_DASHBOARD: parseInt(process.env.CACHE_TTL_MERCHANT_DASHBOARD_MS || '45000', 10),
} as const;
