import { Hono } from 'hono';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';
import { z } from 'zod';
import { redis } from '../config/redis';

export const scheduledMessagesRoutes = new Hono();
scheduledMessagesRoutes.use('/*', jwtMiddleware);

const createScheduleSchema = z.object({
  conversation_id: z.number(),
  content: z.string().min(1, 'Pesan tidak boleh kosong'),
  scheduled_at: z.string().refine(val => {
    const d = new Date(val);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    return diff >= 5 * 60 * 1000 && diff <= 30 * 24 * 60 * 60 * 1000;
  }, 'Waktu jadwal harus minimal 5 menit dan maksimal 30 hari dari sekarang')
});

// Create Schedule
scheduledMessagesRoutes.post('/', async (c) => {
  const accountId = getAccountId(c);
  const userId = c.get('jwtPayload')?.id;

  try {
    const body = await c.req.json();
    const validated = createScheduleSchema.parse(body);

    const [conv] = await sql`
      SELECT id FROM conversations WHERE id = ${validated.conversation_id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!conv) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);

    const [schedule] = await sql`
      INSERT INTO scheduled_messages (
        account_id, conversation_id, content, scheduled_at, created_by
      ) VALUES (
        ${accountId}, ${validated.conversation_id}, ${validated.content}, ${validated.scheduled_at}, ${userId}
      ) RETURNING id, content, scheduled_at, status
    `;

    // Broadcast to ws that a message is scheduled (for ghost bubble)
    await redis.publish('chat:events', JSON.stringify({
      event: 'message.scheduled',
      data: {
        ...schedule,
        conversation_id: validated.conversation_id
      }
    }));

    return c.json({ success: true, data: schedule });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.json({ error: errorMessage || 'Error scheduling message' }, 400);
  }
});

// List schedules for a conversation
scheduledMessagesRoutes.get('/:conversationId', async (c) => {
  const accountId = getAccountId(c);
  const conversationId = c.req.param('conversationId');

  try {
    const schedules = await sql`
      SELECT id, content, scheduled_at, status, created_at 
      FROM scheduled_messages
      WHERE account_id = ${accountId} 
        AND conversation_id = ${conversationId}
        AND status IN ('pending', 'failed')
      ORDER BY scheduled_at ASC
    `;
    return c.json({ success: true, data: schedules });
  } catch (error) {
    return c.json({ error: 'Failed to fetch schedules' }, 500);
  }
});

// Cancel Schedule
scheduledMessagesRoutes.patch('/:id/cancel', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const [schedule] = await sql`
      UPDATE scheduled_messages 
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND account_id = ${accountId} AND status = 'pending'
      RETURNING id, conversation_id
    `;
    
    if (!schedule) return c.json({ error: 'Jadwal tidak ditemukan atau sudah diproses' }, 404);

    // Broadcast cancelled event
    await redis.publish('chat:events', JSON.stringify({
      event: 'message.schedule_cancelled',
      data: {
        id: schedule.id,
        conversation_id: schedule.conversation_id
      }
    }));

    return c.json({ success: true, data: schedule });
  } catch (error) {
    return c.json({ error: 'Failed to cancel schedule' }, 500);
  }
});
