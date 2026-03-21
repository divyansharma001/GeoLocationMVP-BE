// Lightweight in-memory metrics & health collector
// Provides: metricsMiddleware, metricsCollector
// NOTE: In production consider Prometheus or a proper time-series store.

import { Request, Response, NextFunction } from 'express';

interface RequestMetric {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  timestamp: number;
}

class MetricsCollector {
  private startTime = Date.now();
  private requestCount = 0;
  private errorCount = 0;
  private recentRequests: RequestMetric[] = [];
  private responseTimeBuckets: Record<string, number> = {
    '<100ms': 0,
    '100-300ms': 0,
    '300-1000ms': 0,
    '>1000ms': 0,
  };
  private cacheStats = {
    hits: 0,
    misses: 0,
    namespaces: {} as Record<string, { hits: number; misses: number }>,
  };
  private rateLimitHits: Record<string, number> = {};
  private queueStats: Record<string, { added: number; failed: number }> = {};
  private externalApiStats: Record<string, { count: number; totalDurationMs: number; failures: number }> = {};

  incrementRequest() {
    this.requestCount += 1;
  }

  incrementError() {
    this.errorCount += 1;
  }

  recordRequest(metric: RequestMetric) {
    this.recentRequests.push(metric);
    if (this.recentRequests.length > 100) {
      this.recentRequests.shift();
    }
    // Bucket
    if (metric.durationMs < 100) this.responseTimeBuckets['<100ms'] += 1;
    else if (metric.durationMs < 300) this.responseTimeBuckets['100-300ms'] += 1;
    else if (metric.durationMs < 1000) this.responseTimeBuckets['300-1000ms'] += 1;
    else this.responseTimeBuckets['>1000ms'] += 1;
  }

  getMetrics() {
    const uptimeSeconds = Math.round((Date.now() - this.startTime) / 1000);
    return {
      uptimeSeconds,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount ? this.errorCount / this.requestCount : 0,
      responseTimeBuckets: { ...this.responseTimeBuckets },
      cache: {
        ...this.cacheStats,
      },
      rateLimits: { ...this.rateLimitHits },
      queues: { ...this.queueStats },
      externalApis: { ...this.externalApiStats },
      recentRequests: [...this.recentRequests],
      timestamp: new Date().toISOString(),
    };
  }

  recordCacheEvent(type: 'hit' | 'miss', namespace: string) {
    if (type === 'hit') {
      this.cacheStats.hits += 1;
    } else {
      this.cacheStats.misses += 1;
    }

    if (!this.cacheStats.namespaces[namespace]) {
      this.cacheStats.namespaces[namespace] = { hits: 0, misses: 0 };
    }

    this.cacheStats.namespaces[namespace][type === 'hit' ? 'hits' : 'misses'] += 1;
  }

  recordRateLimit(name: string) {
    this.rateLimitHits[name] = (this.rateLimitHits[name] || 0) + 1;
  }

  recordQueueEvent(name: string, type: 'added' | 'failed', count: number = 1) {
    if (!this.queueStats[name]) {
      this.queueStats[name] = { added: 0, failed: 0 };
    }

    this.queueStats[name][type] += count;
  }

  recordExternalApi(name: string, durationMs: number, failed = false) {
    if (!this.externalApiStats[name]) {
      this.externalApiStats[name] = { count: 0, totalDurationMs: 0, failures: 0 };
    }

    this.externalApiStats[name].count += 1;
    this.externalApiStats[name].totalDurationMs += durationMs;
    if (failed) {
      this.externalApiStats[name].failures += 1;
    }
  }

  getHealthStatus() {
    const metrics = this.getMetrics();
    const healthy = metrics.errorRate < 0.2; // arbitrary threshold
    return {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: metrics.timestamp,
      uptimeSeconds: metrics.uptimeSeconds,
      requestCount: metrics.requestCount,
      errorCount: metrics.errorCount,
      errorRate: metrics.errorRate,
    };
  }

  resetMetrics() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.recentRequests = [];
    this.responseTimeBuckets = { '<100ms': 0, '100-300ms': 0, '300-1000ms': 0, '>1000ms': 0 };
    this.cacheStats = { hits: 0, misses: 0, namespaces: {} };
    this.rateLimitHits = {};
    this.queueStats = {};
    this.externalApiStats = {};
    this.startTime = Date.now();
  }
}

export const metricsCollector = new MetricsCollector();

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  metricsCollector.incrementRequest();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const metric: RequestMetric = {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
      durationMs: duration,
      timestamp: Date.now(),
    };
    metricsCollector.recordRequest(metric);
    if (res.statusCode >= 500) metricsCollector.incrementError();
  });

  res.on('error', () => metricsCollector.incrementError());
  next();
}

export default metricsCollector;
