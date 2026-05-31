import { jwt, verify } from 'hono/jwt';

// Validasi Keamanan Kritis: Pastikan JWT_SECRET tersedia
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET environment variable is missing.');
  console.error('Security Policy: Aplikasi dihentikan untuk mencegah kerentanan pemalsuan token JWT.');
  process.exit(1);
}
export const JWT_SECRET = process.env.JWT_SECRET;

export const jwtMiddleware = jwt({ secret: JWT_SECRET, alg: 'HS256' });

export const getPayload = async (token: string) => {
  return await verify(token, JWT_SECRET);
};
