import { jwt, verify } from 'hono/jwt';
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';

// Validasi Keamanan Kritis: Pastikan JWT_SECRET tersedia
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

// Helper yang bisa dipakai di semua route
export function getAccountId(c: Context): number {
  const payload = c.get('jwtPayload') as any;
  if (!payload || !payload.account_id) {
    throw new HTTPException(403, { message: 'Account ID tidak ditemukan dalam token (Forbidden)' });
  }
  return payload.account_id;
}
