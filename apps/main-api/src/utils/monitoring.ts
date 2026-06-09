import * as Sentry from '@sentry/bun';
import { Registry, collectDefaultMetrics, Histogram, Counter } from 'prom-client';
import pino from 'pino';
import type { Context, Next } from 'hono';

// 1. Initialize Sentry
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development'
  });
  console.log('[Monitoring] 🎯 Sentry error tracking initialized');
}

// 2. Initialize Pino Structured Logger
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
});

// 3. Initialize Prometheus Registry
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry]
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 5.0],
  registers: [registry]
});

// Hono request monitoring and logging middleware
export async function monitorMiddleware(c: Context, next: Next) {
  const method = c.req.method;
  const path = c.req.path;
  
  // Skip metrics route itself to prevent infinite loop/noise
  if (path === '/metrics') {
    return await next();
  }

  const end = httpRequestDuration.startTimer({ method, path });

  try {
    await next();
    const status = String(c.res.status);
    httpRequestsTotal.inc({ method, path, status });
    end({ status });
    
    // Structured request log
    logger.info({
      msg: 'Request processed',
      method,
      path,
      status: c.res.status
    });
  } catch (err: any) {
    const status = '500';
    httpRequestsTotal.inc({ method, path, status });
    end({ status });
    
    // Log error
    logger.error({
      msg: 'Request error',
      method,
      path,
      status,
      error: err.message || err
    });
    
    // Send exception to Sentry
    if (process.env.SENTRY_DSN) {
      Sentry.captureException(err);
    }
    
    throw err;
  }
}
