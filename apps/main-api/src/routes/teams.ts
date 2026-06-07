import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';

export const teamsRoutes = new Hono();

teamsRoutes.use('/*', authMiddleware);

const createTeamSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional()
});

teamsRoutes.post('/', zValidator('json', createTeamSchema), async (c) => {
  const accountId = getAccountId(c);
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  const { name, description } = c.req.valid('json');

  try {
    const [newTeam] = await sql`
      INSERT INTO teams (account_id, name, description)
      VALUES (${accountId}, ${name}, ${description || null})
      RETURNING *
    `;
    return c.json({ success: true, data: newTeam }, 201);
  } catch (error: any) {
    if (error.code === '23505') {
      return c.json({ error: 'Nama tim sudah digunakan' }, 400);
    }
    console.error('Error creating team:', error);
    return c.json({ error: 'Gagal membuat tim' }, 500);
  }
});

teamsRoutes.get('/', async (c) => {
  const accountId = getAccountId(c);
  try {
    const teams = await sql`
      SELECT 
        t.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', u.id, 
              'name', u.name, 
              'email', u.email, 
              'role', tm.role
            )
          ) FILTER (WHERE tm.id IS NOT NULL),
          '[]'
        ) as members
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users u ON u.id = tm.user_id
      WHERE t.account_id = ${accountId}
      GROUP BY t.id
      ORDER BY t.name ASC
    `;
    return c.json({ success: true, data: teams });
  } catch (error) {
    console.error('Error getting teams:', error);
    return c.json({ error: 'Gagal mengambil data tim' }, 500);
  }
});

teamsRoutes.put('/:id', zValidator('json', createTeamSchema), async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  const { name, description } = c.req.valid('json');

  try {
    const [updatedTeam] = await sql`
      UPDATE teams
      SET name = ${name}, description = ${description || null}, updated_at = NOW()
      WHERE id = ${teamId} AND account_id = ${accountId}
      RETURNING *
    `;
    if (!updatedTeam) return c.json({ error: 'Tim tidak ditemukan' }, 404);
    return c.json({ success: true, data: updatedTeam });
  } catch (error: any) {
    if (error.code === '23505') {
      return c.json({ error: 'Nama tim sudah digunakan' }, 400);
    }
    return c.json({ error: 'Gagal memperbarui tim' }, 500);
  }
});

teamsRoutes.delete('/:id', async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  try {
    const [deleted] = await sql`
      DELETE FROM teams WHERE id = ${teamId} AND account_id = ${accountId} RETURNING id
    `;
    if (!deleted) return c.json({ error: 'Tim tidak ditemukan' }, 404);
    return c.json({ success: true, message: 'Tim berhasil dihapus' });
  } catch (error) {
    return c.json({ error: 'Gagal menghapus tim' }, 500);
  }
});

const memberSchema = z.object({
  user_id: z.number().int().positive(),
  role: z.enum(['member', 'leader']).optional().default('member')
});

teamsRoutes.post('/:id/members', zValidator('json', memberSchema), async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  const { user_id, role } = c.req.valid('json');

  try {
    // Verifikasi bahwa team adalah milik account ini
    const [team] = await sql`SELECT id FROM teams WHERE id = ${teamId} AND account_id = ${accountId}`;
    if (!team) return c.json({ error: 'Tim tidak ditemukan' }, 404);

    const [newMember] = await sql`
      INSERT INTO team_members (team_id, user_id, role)
      VALUES (${teamId}, ${user_id}, ${role})
      ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING *
    `;
    return c.json({ success: true, data: newMember });
  } catch (error: any) {
    return c.json({ error: 'Gagal menambahkan anggota' }, 500);
  }
});

teamsRoutes.delete('/:teamId/members/:userId', async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('teamId');
  const userId = c.req.param('userId');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  try {
    const [team] = await sql`SELECT id FROM teams WHERE id = ${teamId} AND account_id = ${accountId}`;
    if (!team) return c.json({ error: 'Tim tidak ditemukan' }, 404);

    const [deleted] = await sql`
      DELETE FROM team_members WHERE team_id = ${teamId} AND user_id = ${userId} RETURNING id
    `;
    if (!deleted) return c.json({ error: 'Anggota tidak ditemukan' }, 404);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Gagal menghapus anggota' }, 500);
  }
});

const routingSchema = z.object({
  label_id: z.number().int().positive()
});

teamsRoutes.post('/:id/routing', zValidator('json', routingSchema), async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  const { label_id } = c.req.valid('json');

  try {
    const [team] = await sql`SELECT id FROM teams WHERE id = ${teamId} AND account_id = ${accountId}`;
    if (!team) return c.json({ error: 'Tim tidak ditemukan' }, 404);

    const [label] = await sql`SELECT id FROM labels WHERE id = ${label_id} AND account_id = ${accountId}`;
    if (!label) return c.json({ error: 'Label tidak ditemukan' }, 404);

    const [routing] = await sql`
      INSERT INTO label_team_routing (account_id, team_id, label_id)
      VALUES (${accountId}, ${teamId}, ${label_id})
      ON CONFLICT (label_id, team_id) DO NOTHING
      RETURNING *
    `;
    return c.json({ success: true, data: routing });
  } catch (error) {
    return c.json({ error: 'Gagal menyimpan routing' }, 500);
  }
});

teamsRoutes.get('/:id/routing', async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('id');

  try {
    const routings = await sql`
      SELECT ltr.*, l.title, l.color
      FROM label_team_routing ltr
      JOIN labels l ON l.id = ltr.label_id
      WHERE ltr.team_id = ${teamId} AND ltr.account_id = ${accountId}
    `;
    return c.json({ success: true, data: routings });
  } catch (error) {
    return c.json({ error: 'Gagal mengambil routing' }, 500);
  }
});

teamsRoutes.delete('/:teamId/routing/:labelId', async (c) => {
  const accountId = getAccountId(c);
  const teamId = c.req.param('teamId');
  const labelId = c.req.param('labelId');
  const jwtPayload = c.get('jwtPayload') as any;

  if (jwtPayload?.role !== 'administrator') {
    return c.json({ error: 'Membutuhkan akses administrator' }, 403);
  }

  try {
    const [deleted] = await sql`
      DELETE FROM label_team_routing 
      WHERE team_id = ${teamId} AND label_id = ${labelId} AND account_id = ${accountId}
      RETURNING id
    `;
    if (!deleted) return c.json({ error: 'Routing tidak ditemukan' }, 404);
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Gagal menghapus routing' }, 500);
  }
});

