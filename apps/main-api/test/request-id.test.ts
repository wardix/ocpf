import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { monitorMiddleware } from '../src/utils/monitoring';

describe('Request ID & Structured Logging Middleware', () => {
  it('should generate a new Request ID (UUID) if none is provided', async () => {
    const app = new Hono();
    app.use('*', monitorMiddleware);
    app.get('/test', (c) => {
      const requestId = c.get('requestId');
      const loggerInstance = c.get('logger');
      expect(requestId).toBeDefined();
      expect(loggerInstance).toBeDefined();
      expect(typeof requestId).toBe('string');
      // Verify UUID format
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      return c.text('OK');
    });

    const response = await app.request('/test');
    expect(response.status).toBe(200);
    
    const xRequestId = response.headers.get('X-Request-Id');
    expect(xRequestId).toBeDefined();
    expect(xRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should preserve and reuse the Request ID provided by the client', async () => {
    const app = new Hono();
    app.use('*', monitorMiddleware);
    const clientRequestId = 'custom-request-id-123456';
    
    app.get('/test', (c) => {
      const requestId = c.get('requestId');
      expect(requestId).toBe(clientRequestId);
      return c.text('OK');
    });

    const response = await app.request('/test', {
      headers: {
        'X-Request-Id': clientRequestId,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toBe(clientRequestId);
  });
});
