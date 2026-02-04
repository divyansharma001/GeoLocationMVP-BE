// Simple in-memory cache for leaderboard top lists.
// Keyed only by period + limit (not user specific) so we can reuse for different callers.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

const store = new Map<string, CacheEntry<any>>();

// Cache configuration
const MAX_CACHE_SIZE = 1000; // Maximum number of cache entries
const EVICTION_CHECK_INTERVAL = 60_000; // Run eviction check every 60 seconds

/**
 * Evict expired entries from the cache
 */
function evictExpired(): number {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) {
      store.delete(key);
      evicted++;
    }
  }
  return evicted;
}

/**
 * Evict oldest entries when cache exceeds max size
 */
function evictOldest(targetSize: number): void {
  if (store.size <= targetSize) return;

  // Sort entries by createdAt (oldest first)
  const entries = Array.from(store.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  // Remove oldest entries until we're under the target size
  const toRemove = store.size - targetSize;
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    store.delete(entries[i][0]);
  }
}

/**
 * Ensure cache doesn't exceed max size
 */
function enforceMaxSize(): void {
  if (store.size >= MAX_CACHE_SIZE) {
    // First try evicting expired entries
    evictExpired();

    // If still over limit, evict oldest entries
    if (store.size >= MAX_CACHE_SIZE) {
      evictOldest(Math.floor(MAX_CACHE_SIZE * 0.8)); // Reduce to 80% capacity
    }
  }
}

// Periodic cleanup of expired entries
let cleanupInterval: NodeJS.Timeout | null = null;

function startPeriodicCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const evicted = evictExpired();
    if (evicted > 0 && process.env.NODE_ENV === 'development') {
      console.log(`[Cache] Evicted ${evicted} expired entries. Current size: ${store.size}`);
    }
  }, EVICTION_CHECK_INTERVAL);
  // Don't prevent process from exiting
  cleanupInterval.unref();
}

// Start cleanup on first import
startPeriodicCleanup();

export function makeKey(parts: Record<string, any>): string {
  return Object.entries(parts).sort().map(([k,v]) => `${k}=${v}`).join('&');
}

export function getCache<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  // Enforce max size before adding new entry
  enforceMaxSize();

  const now = Date.now();
  store.set(key, {
    value,
    expiresAt: now + ttlMs,
    createdAt: now
  });
}

export function invalidateLeaderboardCache(granularity?: string): void {
  if (!granularity) {
    store.clear();
    return;
  }
  for (const k of Array.from(store.keys())) {
    if (k.includes(`granularity=${granularity}`)) store.delete(k);
  }
}

/**
 * Get cache statistics (useful for monitoring)
 */
export function getCacheStats(): { size: number; maxSize: number } {
  return {
    size: store.size,
    maxSize: MAX_CACHE_SIZE
  };
}

export function cacheTtlForGranularity(granularity: string): number {
  const envOverride = process.env.LEADERBOARD_CACHE_TTL_SECONDS;
  if (envOverride) {
    const s = parseInt(envOverride, 10); if (s>0) return s*1000;
  }
  switch (granularity) {
    case 'day': return 30_000;        // 30s
    case 'week': return 120_000;      // 2m
    case 'month': return 300_000;     // 5m
    case 'all-time': return 900_000;  // 15m
    default: return 60_000;           // custom
  }
}
