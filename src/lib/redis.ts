import Redis from 'ioredis';
import logger from './logging/logger';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

export const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  logger.error('Redis error:', err);
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

export default redis;
