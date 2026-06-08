import { Hono } from 'hono';
import { sql } from '../config/database';
import { authMiddleware, getAccountId } from '../middleware/auth';

export const analyticsRoutes = new Hono();

analyticsRoutes.use('/*', authMiddleware);

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

    const startDateStr = c.req.query('start_date');
    const endDateStr = c.req.query('end_date');
    
    let startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = endDateStr ? new Date(endDateStr) : new Date();
    if (endDateStr && endDateStr.length === 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    // 1. Average Rating & Total Ratings
    const [summary] = await sql`
      SELECT COALESCE(AVG(rating)::float, 0) as avg_rating, COUNT(*)::int as total_ratings 
      FROM csat_ratings 
      WHERE account_id = ${accountId}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
    `;

    // 2. Rating Distribution (1-5)
    const distribution = await sql`
      SELECT rating, COUNT(*)::int as count 
      FROM csat_ratings 
      WHERE account_id = ${accountId} 
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
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
        AND cr.created_at >= ${startDate}
        AND cr.created_at <= ${endDate}
      GROUP BY u.id, u.name
      ORDER BY avg_rating DESC
    `;

    // 4. Response Rate Stats
    const [rates] = await sql`
      SELECT 
        (SELECT COUNT(*)::int FROM tickets WHERE account_id = ${accountId} AND csat_survey_sent = true AND resolved_at >= ${startDate} AND resolved_at <= ${endDate}) as total_surveys_sent,
        (SELECT COUNT(*)::int FROM csat_ratings WHERE account_id = ${accountId} AND created_at >= ${startDate} AND created_at <= ${endDate}) as total_responses
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

    const startDateStr = c.req.query('start_date');
    const endDateStr = c.req.query('end_date');

    let startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = endDateStr ? new Date(endDateStr) : new Date();
    if (endDateStr && endDateStr.length === 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('per_page') || '25', 10)));
    const offset = (page - 1) * perPage;

    const [totalRow] = await sql`
      SELECT COUNT(*)::int as count FROM csat_ratings 
      WHERE account_id = ${accountId}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
    `;

    const ratingsList = await sql`
      SELECT cr.id, cr.rating, cr.feedback, cr.created_at, cr.ticket_id, u.name as agent_name, c.name as contact_name
      FROM csat_ratings cr
      LEFT JOIN users u ON cr.assigned_agent_id = u.id
      JOIN contacts c ON cr.contact_id = c.id
      WHERE cr.account_id = ${accountId}
        AND c.deleted_at IS NULL
        AND cr.created_at >= ${startDate}
        AND cr.created_at <= ${endDate}
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

// GET /api/analytics/overview
analyticsRoutes.get('/overview', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    const startDateStr = c.req.query('start_date');
    const endDateStr = c.req.query('end_date');
    
    let startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = endDateStr ? new Date(endDateStr) : new Date();
    if (endDateStr && endDateStr.length === 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    const [totals] = await sql`
      SELECT 
        COUNT(*)::int as total_tickets,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END)::int as resolved_tickets
      FROM tickets
      WHERE account_id = ${accountId}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
    `;

    const [frt] = await sql`
      WITH TicketFirstResponse AS (
        SELECT 
          t.id as ticket_id,
          EXTRACT(EPOCH FROM (MIN(m.created_at) - t.created_at))::float as response_delay
        FROM tickets t
        JOIN messages m ON m.ticket_id = t.id
        WHERE t.account_id = ${accountId}
          AND t.created_at >= ${startDate}
          AND t.created_at <= ${endDate}
          AND m.sender_type = 'User'
        GROUP BY t.id, t.created_at
      )
      SELECT 
        COALESCE(AVG(response_delay)::float, 0) as avg_frt,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_delay)::float, 0) as median_frt
      FROM TicketFirstResponse;
    `;

    const [resTime] = await sql`
      WITH TicketResolution AS (
        SELECT 
          EXTRACT(EPOCH FROM (resolved_at - created_at))::float as resolution_delay
        FROM tickets
        WHERE account_id = ${accountId}
          AND status = 'resolved'
          AND resolved_at IS NOT NULL
          AND resolved_at >= ${startDate}
          AND resolved_at <= ${endDate}
      )
      SELECT 
        COALESCE(AVG(resolution_delay)::float, 0) as avg_resolution,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolution_delay)::float, 0) as median_resolution
      FROM TicketResolution;
    `;

    return c.json({
      success: true,
      data: {
        total_tickets: totals?.total_tickets || 0,
        resolved_tickets: totals?.resolved_tickets || 0,
        avg_frt: frt?.avg_frt || 0,
        median_frt: frt?.median_frt || 0,
        avg_resolution_time: resTime?.avg_resolution || 0,
        median_resolution_time: resTime?.median_resolution || 0
      }
    });
  } catch (error) {
    console.error('Error fetch overview analytics:', error);
    return c.json({ error: 'Gagal mengambil data analitik overview' }, 500);
  }
});

// GET /api/analytics/volume
analyticsRoutes.get('/volume', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    const startDateStr = c.req.query('start_date');
    const endDateStr = c.req.query('end_date');
    const granularity = c.req.query('granularity') || 'daily';

    let startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = endDateStr ? new Date(endDateStr) : new Date();
    if (endDateStr && endDateStr.length === 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    let truncUnit = 'day';
    if (granularity === 'hourly') truncUnit = 'hour';
    else if (granularity === 'weekly') truncUnit = 'week';

    const volumeData = await sql`
      SELECT 
        DATE_TRUNC(${truncUnit}, created_at) as period,
        COUNT(*)::int as count
      FROM tickets
      WHERE account_id = ${accountId}
        AND created_at >= ${startDate}
        AND created_at <= ${endDate}
      GROUP BY period
      ORDER BY period ASC
    `;

    const formatted = volumeData.map((row: any) => ({
      period: new Date(row.period).toISOString(),
      count: row.count
    }));

    return c.json({
      success: true,
      data: formatted
    });
  } catch (error) {
    console.error('Error fetch volume analytics:', error);
    return c.json({ error: 'Gagal mengambil data volume analitik' }, 500);
  }
});

// GET /api/analytics/agents
analyticsRoutes.get('/agents', async (c) => {
  try {
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }
    const accountId = getAccountId(c);

    const startDateStr = c.req.query('start_date');
    const endDateStr = c.req.query('end_date');

    let startDate = startDateStr ? new Date(startDateStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let endDate = endDateStr ? new Date(endDateStr) : new Date();
    if (endDateStr && endDateStr.length === 10) {
      endDate.setHours(23, 59, 59, 999);
    }

    const leaderboard = await sql`
      SELECT 
        u.id as agent_id,
        u.name as agent_name,
        COUNT(DISTINCT t.id)::int as assigned_tickets,
        COUNT(DISTINCT CASE WHEN t.status = 'resolved' THEN t.id END)::int as resolved_tickets,
        COALESCE(AVG(cr.rating)::float, 0) as avg_csat,
        COUNT(DISTINCT cr.id)::int as total_csat_responses,
        (
          SELECT COUNT(*)::int 
          FROM messages m 
          WHERE m.sender_id = u.id 
            AND m.sender_type = 'User' 
            AND m.created_at >= ${startDate}
            AND m.created_at <= ${endDate}
        ) as messages_sent
      FROM users u
      JOIN account_users au ON au.user_id = u.id
      LEFT JOIN tickets t ON t.assignee_id = u.id 
        AND t.account_id = ${accountId}
        AND t.created_at >= ${startDate}
        AND t.created_at <= ${endDate}
      LEFT JOIN csat_ratings cr ON cr.assigned_agent_id = u.id 
        AND cr.account_id = ${accountId}
        AND cr.created_at >= ${startDate}
        AND cr.created_at <= ${endDate}
      WHERE au.account_id = ${accountId}
      GROUP BY u.id, u.name
      ORDER BY resolved_tickets DESC
    `;

    return c.json({
      success: true,
      data: leaderboard || []
    });
  } catch (error) {
    console.error('Error fetch agents analytics:', error);
    return c.json({ error: 'Gagal mengambil data leaderboard agen' }, 500);
  }
});
