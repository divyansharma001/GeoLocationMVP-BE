// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const isDevelopment = process.env.NODE_ENV === 'development';
const SLOW_QUERY_THRESHOLD_MS = 1000; // Log queries slower than 1 second

const prisma = new PrismaClient({
  transactionOptions: {
    maxWait: 20000, // 20 seconds max wait
    timeout: 20000, // 20 seconds timeout
  },
  log: [
    { level: 'query', emit: 'event' },
    { level: 'warn', emit: 'stdout' },
    { level: 'error', emit: 'stdout' },
  ],
});

// Query performance logging via events (preferred over deprecated $use middleware)
prisma.$on('query', (e) => {
  // Log slow queries in any environment
  if (e.duration > SLOW_QUERY_THRESHOLD_MS) {
    console.warn(
      `[Prisma] Slow query detected (${e.duration}ms): ${e.query.slice(0, 200)}...`
    );
  } else if (isDevelopment && e.duration > 100) {
    // In development, also log moderately slow queries (>100ms)
    console.log(`[Prisma Query] ${e.duration}ms - ${e.query.slice(0, 150)}...`);
  }
});

export default prisma;
