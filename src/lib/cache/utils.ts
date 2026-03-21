import crypto from 'crypto';
import { getCache } from './index';
import { metricsCollector } from '../metrics';

export interface CacheReadOptions<T> {
  key: string;
  ttlMs: number;
  namespace?: string;
  loader: () => Promise<T>;
}

function withNamespace(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}:${key}` : key;
}

export function createCacheKey(parts: Array<unknown>): string {
  const normalized = parts.map((part) => String(part ?? '')).join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function getOrSetCache<T>(options: CacheReadOptions<T>): Promise<{ value: T; hit: boolean }> {
  const cache = getCache();
  const cacheKey = withNamespace(options.namespace, options.key);
  const cached = await cache.get<T>(cacheKey);

  if (cached !== null) {
    metricsCollector.recordCacheEvent('hit', options.namespace || 'default');
    return { value: cached, hit: true };
  }

  metricsCollector.recordCacheEvent('miss', options.namespace || 'default');
  const value = await options.loader();
  await cache.set(cacheKey, value, options.ttlMs);
  return { value, hit: false };
}

export async function invalidateCachePattern(pattern: string, namespace?: string): Promise<void> {
  const cache = getCache();
  await cache.deletePattern(withNamespace(namespace, pattern));
}

export async function invalidateCacheKey(key: string, namespace?: string): Promise<void> {
  const cache = getCache();
  await cache.delete(withNamespace(namespace, key));
}
