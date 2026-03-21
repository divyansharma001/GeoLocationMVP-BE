import { CacheConfig, CacheProvider, CacheStats } from './cache.interface';
import redis from '../redis';

function toSeconds(ttlMs: number): number {
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

export class RedisCache implements CacheProvider {
  private readonly keyPrefix: string;
  private readonly maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(config: CacheConfig = {}) {
    this.keyPrefix = config.keyPrefix || '';
    this.maxSize = config.maxSize || 0;
  }

  private prefixKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const value = await redis.get(prefixedKey);

    if (value == null) {
      this.misses += 1;
      return null;
    }

    this.hits += 1;
    return JSON.parse(value) as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    await redis.set(prefixedKey, JSON.stringify(value), 'EX', toSeconds(ttlMs));
  }

  async delete(key: string): Promise<void> {
    await redis.del(this.prefixKey(key));
  }

  async deletePattern(pattern: string): Promise<void> {
    const prefixedPattern = this.prefixKey(pattern);
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', prefixedPattern, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  async clear(): Promise<void> {
    if (!this.keyPrefix) {
      await redis.flushdb();
      return;
    }

    await this.deletePattern('*');
  }

  async getStats(): Promise<CacheStats> {
    let size = 0;
    if (this.keyPrefix) {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          this.prefixKey('*'),
          'COUNT',
          100
        );
        cursor = nextCursor;
        size += keys.length;
      } while (cursor !== '0');
    } else {
      size = await redis.dbsize();
    }

    const total = this.hits + this.misses;
    return {
      size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
}
