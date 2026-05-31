import { Hono } from 'hono';
import { sql } from '../config/database';
import { jwtMiddleware } from '../middleware/auth';

export const analyticsRoutes = new Hono();

analyticsRoutes.use('/*', jwtMiddleware);

analyticsRoutes.get('/', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload');
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const [totalIncoming] = await sql`
      SELECT COUNT(DISTINCT ticket_id) as count 
      FROM messages 
      WHERE sender_type = 'Contact' 
      AND created_at >= CURRENT_DATE
    `;

    const [totalResolved] = await sql`
      SELECT COUNT(*) as count 
      FROM conversation_events 
      WHERE event_type = 'status_changed' 
      AND event_data->>'new_status' = 'resolved'
      AND created_at >= CURRENT_DATE
    `;

    const statusCounts = await sql`
      SELECT status, COUNT(*) as count 
      FROM tickets 
      WHERE account_id = 1
      GROUP BY status
    `;

    const agentPerformance = await sql`
      SELECT 
        u.name, 
        COUNT(ce.id) as resolved_count
      FROM conversation_events ce
      JOIN users u ON ce.actor_id = u.id
      WHERE ce.event_type = 'status_changed' 
        AND ce.event_data->>'new_status' = 'resolved'
        AND ce.actor_type = 'User'
        AND ce.created_at >= CURRENT_DATE
      GROUP BY u.id, u.name
      ORDER BY resolved_count DESC
    `;

    return c.json({
      success: true,
      data: {
        today: {
          incoming_tickets: parseInt(totalIncoming?.count || '0'),
          resolved_tickets: parseInt(totalResolved?.count || '0')
        },
        current_status: statusCounts || [],
        agent_performance: agentPerformance || []
      }
    });
  } catch (error) {
    console.error('Error fetch analytics:', error);
    return c.json({ error: 'Gagal mengambil data analitik' }, 500);
  }
});
