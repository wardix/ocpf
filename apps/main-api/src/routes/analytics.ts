import { Hono } from 'hono';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';

export const analyticsRoutes = new Hono();

analyticsRoutes.use('/*', jwtMiddleware);

analyticsRoutes.get('/', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    const [totalIncoming] = await sql`
      SELECT COUNT(DISTINCT ticket_id) as count 
      FROM messages 
      WHERE sender_type = 'Contact' 
      AND account_id = ${accountId}
      AND created_at >= CURRENT_DATE
    `;

    const [totalResolved] = await sql`
      SELECT COUNT(*) as count 
      FROM conversation_events 
      WHERE event_type = 'status_changed' 
      AND event_data->>'new_status' = 'resolved'
      AND account_id = ${accountId}
      AND created_at >= CURRENT_DATE
    `;

    const statusCounts = await sql`
      SELECT status, COUNT(*) as count 
      FROM tickets 
      WHERE account_id = ${accountId}
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
        AND ce.account_id = ${accountId}
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

// GET /api/analytics/csat
analyticsRoutes.get('/csat', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    // 1. Average Rating & Total Ratings
    const [summary] = await sql`
      SELECT COALESCE(AVG(rating)::float, 0) as avg_rating, COUNT(*)::int as total_ratings 
      FROM csat_ratings 
      WHERE account_id = ${accountId}
    `;

    // 2. Rating Distribution (1-5)
    const distribution = await sql`
      SELECT rating, COUNT(*)::int as count 
      FROM csat_ratings 
      WHERE account_id = ${accountId} 
      GROUP BY rating 
      ORDER BY rating DESC
    `;

    // Make sure we have entries for 1-5 even if count is 0
    const distributionMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribution.forEach((row: any) => {
      distributionMap[row.rating] = row.count;
    });

    const formattedDistribution = Object.keys(distributionMap).map(key => ({
      rating: parseInt(key, 10),
      count: distributionMap[parseInt(key, 10)]
    })).sort((a, b) => b.rating - a.rating);

    // 3. Per-Agent Breakdown
    const agentBreakdown = await sql`
      SELECT u.name, COALESCE(AVG(cr.rating)::float, 0) as avg_rating, COUNT(cr.id)::int as total_ratings
      FROM csat_ratings cr
      JOIN users u ON cr.assigned_agent_id = u.id
      WHERE cr.account_id = ${accountId}
      GROUP BY u.id, u.name
      ORDER BY avg_rating DESC
    `;

    // 4. Response Rate Stats
    const [rates] = await sql`
      SELECT 
        (SELECT COUNT(*)::int FROM tickets WHERE account_id = ${accountId} AND csat_survey_sent = true) as total_surveys_sent,
        (SELECT COUNT(*)::int FROM csat_ratings WHERE account_id = ${accountId}) as total_responses
    `;

    const surveysSent = rates?.total_surveys_sent || 0;
    const responses = rates?.total_responses || 0;
    const responseRate = surveysSent > 0 ? (responses / surveysSent) * 100 : 0;

    return c.json({
      success: true,
      data: {
        avg_rating: summary?.avg_rating || 0,
        total_ratings: summary?.total_ratings || 0,
        distribution: formattedDistribution,
        agent_performance: agentBreakdown || [],
        response_rate: {
          surveys_sent: surveysSent,
          responses: responses,
          percentage: parseFloat(responseRate.toFixed(1))
        }
      }
    });
  } catch (error) {
    console.error('Error fetch CSAT analytics:', error);
    return c.json({ error: 'Gagal mengambil data analitik CSAT' }, 500);
  }
});

// GET /api/analytics/csat/ratings
analyticsRoutes.get('/csat/ratings', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10)));
    const offset = (page - 1) * perPage;

    const [totalRow] = await sql`
      SELECT COUNT(*)::int as count FROM csat_ratings WHERE account_id = ${accountId}
    `;

    const ratingsList = await sql`
      SELECT cr.id, cr.rating, cr.feedback, cr.created_at, cr.ticket_id, u.name as agent_name, c.name as contact_name
      FROM csat_ratings cr
      LEFT JOIN users u ON cr.assigned_agent_id = u.id
      JOIN contacts c ON cr.contact_id = c.id
      WHERE cr.account_id = ${accountId}
      ORDER BY cr.created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    return c.json({
      success: true,
      data: ratingsList || [],
      meta: {
        page,
        per_page: perPage,
        total: totalRow?.count || 0
      }
    });
  } catch (error) {
    console.error('Error fetch CSAT ratings list:', error);
    return c.json({ error: 'Gagal mengambil daftar penilaian CSAT' }, 500);
  }
});
