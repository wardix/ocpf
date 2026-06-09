import { describe, it, expect } from 'bun:test';
import { app } from '../src/index';

describe('Health Check Endpoint (GET /healthz)', () => {
  it('should return 200 with healthy status details', async () => {
    const response = await app.request('/healthz');
    
    expect(response.status).toBe(200);
    const body = await response.json();
    
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
    expect(body.uptime).toBeDefined();
    expect(typeof body.uptime).toBe('number');
  });
});
