import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { requirePermission } from '../src/middleware/auth';
import { sign } from 'hono/jwt';
import { JWT_SECRET } from '../src/middleware/auth';

describe('requirePermission Middleware (Issue #57)', () => {
  const setupTestApp = (requiredPermission: string) => {
    const app = new Hono();
    
    // Mock authentication middleware to simulate JWT payload
    app.use('*', async (c, next) => {
      const authHeader = c.req.header('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
          const { verify } = await import('hono/jwt');
          const payload = await verify(token, JWT_SECRET, 'HS256') as any;
          c.set('account_id', payload.account_id);
          c.set('user_id', payload.id);
          c.set('user_role', payload.role);
          c.set('auth_method', 'jwt');
        } catch (e) {
          // Ignore jwt decode failure in mock
        }
      } else if (c.req.header('X-API-Key') === 'valid-api-key') {
        c.set('account_id', 1);
        c.set('permissions', ['chatbot.read', 'conversations.read']);
        c.set('auth_method', 'api_key');
      }
      await next();
    });

    app.get('/protected', requirePermission(requiredPermission), (c) => {
      return c.json({ success: true, message: 'Access granted' });
    });

    return app;
  };

  it('should allow JWT administrator access to any permission (even non-agent ones)', async () => {
    const app = setupTestApp('some.restricted.admin.permission');
    
    const adminToken = await sign({
      id: 1,
      account_id: 1,
      role: 'administrator',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    const response = await app.request('/protected', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('should allow JWT agent access to agent-allowed permission (e.g. conversations.read)', async () => {
    const app = setupTestApp('conversations.read');
    
    const agentToken = await sign({
      id: 2,
      account_id: 1,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    const response = await app.request('/protected', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${agentToken}`
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('should reject JWT agent access to forbidden permission (e.g. users.write)', async () => {
    const app = setupTestApp('users.write');
    
    const agentToken = await sign({
      id: 2,
      account_id: 1,
      role: 'agent',
      exp: Math.floor(Date.now() / 1000) + 3600
    }, JWT_SECRET);

    const response = await app.request('/protected', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${agentToken}`
      }
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('Missing required permission');
  });

  it('should allow API Key access if it includes the required permission', async () => {
    const app = setupTestApp('chatbot.read');

    const response = await app.request('/protected', {
      method: 'GET',
      headers: {
        'X-API-Key': 'valid-api-key'
      }
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it('should reject API Key access if it lacks the required permission', async () => {
    const app = setupTestApp('chatbot.write');

    const response = await app.request('/protected', {
      method: 'GET',
      headers: {
        'X-API-Key': 'valid-api-key'
      }
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain('Missing required permission');
  });
});
