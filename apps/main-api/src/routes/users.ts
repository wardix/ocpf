import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { redis, PUB_SUB_CH } from '../config/redis';

export const usersRoutes = new Hono();

usersRoutes.use('/*', authMiddleware);

usersRoutes.get('/agents', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    
    // Semua user (admin/agen) bisa memanggil ini untuk keperluan dropdown UI
    const agents = await sql`
      SELECT u.id, u.name, au.availability_status
      FROM users u
      JOIN account_users au ON u.id = au.user_id
      WHERE au.account_id = ${jwtPayload.account_id}
      ORDER BY u.name ASC
    `;
    return c.json(agents);
  } catch (error) {
    console.error('Error fetch agents:', error);
    return c.json({ error: 'Gagal mengambil daftar agen' }, 500);
  }
});

usersRoutes.get('/', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const users = await sql`
      SELECT u.id, u.name, u.email, au.role, u.created_at
      FROM users u
      JOIN account_users au ON u.id = au.user_id
      WHERE au.account_id = ${jwtPayload.account_id}
      ORDER BY u.id ASC
    `;
    return c.json(users);
  } catch (error) {
    console.error('Error fetch users:', error);
    return c.json({ error: 'Gagal mengambil daftar pengguna' }, 500);
  }
});

const availabilitySchema = z.object({
  status: z.enum(['online', 'busy', 'offline'])
});

usersRoutes.patch('/me/availability', zValidator('json', availabilitySchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    const { status } = c.req.valid('json');

    const [result] = await sql`
      UPDATE account_users
      SET availability_status = ${status}
      WHERE user_id = ${jwtPayload.id} AND account_id = ${jwtPayload.account_id}
      RETURNING user_id, availability_status
    `;

    if (!result) return c.json({ error: 'User tidak ditemukan' }, 404);

    // Broadcast ke semua WebSocket connections di akun yang sama
    await redis.publish(PUB_SUB_CH, JSON.stringify({
      event: 'agent.availability_changed',
      data: {
        account_id: jwtPayload.account_id,
        user_id: jwtPayload.id,
        name: jwtPayload.name,
        availability_status: status
      }
    }));

    return c.json({ success: true, data: result });
  } catch (error) {
    console.error('Error update availability:', error);
    return c.json({ error: 'Gagal update status availability' }, 500);
  }
});

const createUserSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.enum(['administrator', 'agent'])
});

usersRoutes.post('/', zValidator('json', createUserSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
  }
}), async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const { name, email, password, role } = c.req.valid('json');

    const [existing] = await sql`SELECT id FROM users WHERE email = ${email}`;
    if (existing) {
      return c.json({ error: 'Email sudah terdaftar' }, 400);
    }

    const passwordHash = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const [newUser] = await sql`
      WITH inserted_user AS (
        INSERT INTO users (name, email, password_hash)
        VALUES (${name}, ${email}, ${passwordHash})
        RETURNING id, name, email
      )
      INSERT INTO account_users (account_id, user_id, role)
      SELECT ${jwtPayload.account_id}, id, ${role} FROM inserted_user
      RETURNING user_id as id, role;
    `;

    return c.json({ success: true, data: { id: newUser.id, name, email, role } });
  } catch (error) {
    console.error('Error create user:', error);
    return c.json({ error: 'Gagal membuat pengguna' }, 500);
  }
});
