import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { JWT_SECRET } from '../middleware/auth';
import { sign } from 'hono/jwt';

export const authRoutes = new Hono();

const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter')
});

authRoutes.post('/login', zValidator('json', loginSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  try {
    const { email, password } = c.req.valid('json');

    const [user] = await sql`
      SELECT u.id, u.name, u.email, u.password_hash, au.role, au.account_id 
      FROM users u
      LEFT JOIN account_users au ON u.id = au.user_id
      WHERE u.email = ${email} 
      LIMIT 1
    `;

    if (!user) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    if (!user.account_id) {
      return c.json({ error: 'User tidak terikat dengan akun manapun' }, 403);
    }

    const isMatch = await Bun.password.verify(password, user.password_hash);
    
    if (!isMatch) {
      return c.json({ error: 'Kredensial tidak valid' }, 401);
    }

    const payload = {
      id: user.id,
      name: user.name,
      email: user.email,
      account_id: user.account_id,
      role: user.role || 'agent',
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
    };
    const token = await sign(payload, JWT_SECRET);

    return c.json({ 
      success: true, 
      token, 
      user: { id: user.id, name: user.name, email: user.email, role: user.role || 'agent', account_id: user.account_id } 
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ error: 'Terjadi kesalahan pada server' }, 500);
  }
});
