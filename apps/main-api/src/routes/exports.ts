import { Hono } from 'hono';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';
import { redis } from '../config/redis';
import { z } from 'zod';
import { serveStatic } from 'hono/bun';
import fs from 'fs';
import path from 'path';

export const exportsRoutes = new Hono();
exportsRoutes.use('/*', authMiddleware);

const createExportSchema = z.object({
  export_type: z.enum(['conversations', 'agent_performance', 'contacts']),
  export_format: z.enum(['csv', 'xlsx']),
  filters: z.record(z.string(), z.any()).optional()
});

// Enqueue export job
exportsRoutes.post('/', async (c) => {
  const accountId = getAccountId(c);
  const userId = (c.get('jwtPayload') as any)?.id;

  try {
    const body = await c.req.json();
    const validated = createExportSchema.parse(body);

    const [job] = await sql`
      INSERT INTO export_jobs (
        account_id, export_type, export_format, filters, created_by
      ) VALUES (
        ${accountId}, ${validated.export_type}, ${validated.export_format}, ${validated.filters || {}}, ${userId}
      ) RETURNING id, export_type, status, created_at
    `;

    // Push to Redis Queue
    await redis.lpush('queue:export_jobs', JSON.stringify({ jobId: job.id, accountId }));

    return c.json({ success: true, data: job }, 202);
  } catch (error: any) {
    return c.json({ error: error.message || 'Gagal membuat job export' }, 400);
  }
});

// List jobs
exportsRoutes.get('/', async (c) => {
  const accountId = getAccountId(c);

  try {
    const jobs = await sql`
      SELECT id, export_type, export_format, status, file_size_bytes, row_count, progress_percent, expires_at, created_at 
      FROM export_jobs
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    
    return c.json({ success: true, data: jobs });
  } catch (error: any) {
    return c.json({ error: 'Gagal memuat history export' }, 500);
  }
});

// Serve download securely
exportsRoutes.get('/:id/download', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const [job] = await sql`
      SELECT file_path, status, expires_at FROM export_jobs 
      WHERE id = ${id} AND account_id = ${accountId}
    `;

    if (!job) return c.json({ error: 'Job tidak ditemukan' }, 404);
    if (job.status !== 'completed' || !job.file_path) return c.json({ error: 'File belum siap atau gagal' }, 400);
    if (new Date(job.expires_at) < new Date()) return c.json({ error: 'File sudah kadaluarsa' }, 410);

    const absolutePath = path.resolve(job.file_path);
    const exportsDir = path.resolve(process.cwd(), 'exports');
    if (!absolutePath.startsWith(exportsDir)) {
      return c.json({ error: 'Invalid file path' }, 403);
    }

    if (!fs.existsSync(absolutePath)) {
      return c.json({ error: 'File tidak ditemukan di server' }, 404);
    }

    const fileStream = fs.createReadStream(absolutePath);
    const fileName = path.basename(absolutePath);
    const ext = path.extname(absolutePath);
    const contentType = ext === '.xlsx' 
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      : 'text/csv';

    return new Response(fileStream as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });
  } catch (error) {
    return c.json({ error: 'Gagal mengunduh file' }, 500);
  }
});
