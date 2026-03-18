import Redis from 'ioredis';
import logger from './logging/logger';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    const delay = Math.min(times * 500, 30000);
    return delay;
  }
};

export const redis = new Redis(redisConfig);

let lastRedisErrorSignature = '';
let lastRedisErrorAt = 0;

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  const code = (err as any)?.code || 'UNKNOWN';
  const message = err?.message || String(err);
  const signature = `${code}:${message}`;
  const now = Date.now();

  if (signature === lastRedisErrorSignature && now - lastRedisErrorAt < 30000) {
    return;
  }

  lastRedisErrorSignature = signature;
  lastRedisErrorAt = now;

  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    logger.warn(`Redis unavailable (${code}): ${message}`);
    return;
  }

  logger.error(`Redis error (${code}): ${message}`);
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

export default redis;
