import { jwt, verify } from 'hono/jwt';
import { HTTPException } from 'hono/http-exception';
import type { Context, Next } from 'hono';
import { sql } from '../config/database';
import crypto from 'crypto';

if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is missing.');
  console.error('Security Policy: Aplikasi dihentikan untuk mencegah kerentanan pemalsuan token JWT.');
  process.exit(1);
}
export const JWT_SECRET = process.env.JWT_SECRET;

export const jwtMiddleware = jwt({ secret: JWT_SECRET, alg: 'HS256' });

export const getPayload = async (token: string) => {
  return await verify(token, JWT_SECRET, 'HS256');
};

export const authMiddleware = async (c: Context, next: Next) => {
  const apiKey = c.req.header('X-API-Key');
  if (apiKey) {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const [keyRecord] = await sql`
      SELECT account_id, permissions FROM api_keys 
      WHERE key_hash = ${hash} AND revoked_at IS NULL
    `;
    if (!keyRecord) {
      throw new HTTPException(401, { message: 'Invalid or revoked API Key' });
    }
    await sql`UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = ${hash}`;
    c.set('account_id', keyRecord.account_id);
    c.set('permissions', keyRecord.permissions);
    c.set('auth_method', 'api_key');
    return next();
  }

  // Fallback to JWT
  await jwtMiddleware(c, async () => {
    const payload = c.get('jwtPayload') as any;
    if (payload && payload.account_id) {
      c.set('account_id', payload.account_id);
      c.set('user_id', payload.id);
      c.set('user_role', payload.role);
      c.set('auth_method', 'jwt');
    }
  });
  
  if (c.get('account_id')) {
    await next();
  } else {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
};

export function requirePermission(requiredPermission: string) {
  return async (c: Context, next: Next) => {
    const authMethod = c.get('auth_method');
    if (authMethod === 'jwt') {
      // JWT/Dashboard users usually have full access within their role limits
      return next();
    }
    if (authMethod === 'api_key') {
      const permissions = c.get('permissions') || [];
      if (!permissions.includes(requiredPermission)) {
        throw new HTTPException(403, { message: \`Missing required permission: \${requiredPermission}\` });
      }
      return next();
    }
    throw new HTTPException(401, { message: 'Unauthorized' });
  };
}

export function getAccountId(c: Context): number {
  const accountId = c.get('account_id');
  if (!accountId) {
    throw new HTTPException(403, { message: 'Account ID tidak ditemukan (Forbidden)' });
  }
  return Number(accountId);
}
