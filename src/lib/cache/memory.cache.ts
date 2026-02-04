/**
 * In-Memory Cache Implementation
 *
 * A simple, efficient in-memory cache with:
 * - LRU-like eviction (oldest entries removed first)
 * - Automatic expiration
 * - Size limits to prevent memory leaks
 * - Hit/miss tracking for monitoring
 *
 * Note: This cache is NOT shared across multiple server instances.
 * For multi-instance deployments, use RedisCache instead.
 */

import { CacheProvider, CacheStats, CacheConfig } from './cache.interface';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

export class MemoryCache implements CacheProvider {
  private store = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;
  private readonly maxSize: number;
  private readonly keyPrefix: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: CacheConfig = {}) {
    this.maxSize = config.maxSize || 1000;
    this.keyPrefix = config.keyPrefix || '';

    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const entry = this.store.get(prefixedKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(prefixedKey);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    // Enforce max size before adding
    this.enforceMaxSize();

    const prefixedKey = this.prefixKey(key);
    const now = Date.now();

    this.store.set(prefixedKey, {
      value,
      expiresAt: now + ttlMs,
      createdAt: now,
    });
  }

  async delete(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    this.store.delete(prefixedKey);
  }

  async deletePattern(pattern: string): Promise<void> {
    const prefixedPattern = this.prefixKey(pattern);
    // Convert simple wildcard pattern to regex
    const regex = new RegExp(
      '^' + prefixedPattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );

    for (const key of Array.from(this.store.keys())) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  async getStats(): Promise<CacheStats> {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  async isHealthy(): Promise<boolean> {
    return true; // Memory cache is always "healthy"
  }

  /**
   * Evict expired entries
   */
  private evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Evict oldest entries when over max size
   */
  private evictOldest(targetSize: number): void {
    if (this.store.size <= targetSize) return;

    const entries = Array.from(this.store.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    const toRemove = this.store.size - targetSize;
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.store.delete(entries[i][0]);
    }
  }

  /**
   * Ensure cache doesn't exceed max size
   */
  private enforceMaxSize(): void {
    if (this.store.size >= this.maxSize) {
      this.evictExpired();

      if (this.store.size >= this.maxSize) {
        this.evictOldest(Math.floor(this.maxSize * 0.8));
      }
    }
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const evicted = this.evictExpired();
      if (evicted > 0 && process.env.NODE_ENV === 'development') {
        console.log(`[MemoryCache] Evicted ${evicted} expired entries. Size: ${this.store.size}`);
      }
    }, 60_000); // Every 60 seconds

    this.cleanupInterval.unref();
  }

  /**
   * Stop the cache (cleanup interval)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton instance for general use
let defaultCache: MemoryCache | null = null;

export function getDefaultCache(): MemoryCache {
  if (!defaultCache) {
    defaultCache = new MemoryCache({
      maxSize: 1000,
      keyPrefix: 'app',
    });
  }
  return defaultCache;
}
