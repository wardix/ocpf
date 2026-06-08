import { Hono } from 'hono';
import { sql } from '../config/database';

export const notificationsRoutes = new Hono();

// GET /api/notifications
// Get paginated list of user notifications
notificationsRoutes.get('/', async (c) => {
  const user = c.get('user');
  const accountId = user.account_id;
  const page = parseInt(c.req.query('page') || '1', 10);
  const perPage = parseInt(c.req.query('per_page') || '20', 10);
  const offset = (page - 1) * perPage;

  try {
    const notifications = await sql`
      SELECT * FROM notifications
      WHERE account_id = ${accountId} AND user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    const [{ count }] = await sql`
      SELECT count(*) as count FROM notifications
      WHERE account_id = ${accountId} AND user_id = ${user.id}
    `;

    const [{ unread_count }] = await sql`
      SELECT count(*) as unread_count FROM notifications
      WHERE account_id = ${accountId} AND user_id = ${user.id} AND read_at IS NULL
    `;

    return c.json({
      success: true,
      data: notifications,
      meta: {
        page,
        per_page: perPage,
        total: parseInt(count, 10),
        unread_count: parseInt(unread_count, 10)
      }
    });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

// PUT /api/notifications/:id/read
// Mark a specific alert as read
notificationsRoutes.put('/:id/read', async (c) => {
  const user = c.get('user');
  const accountId = user.account_id;
  const notificationId = parseInt(c.req.param('id'), 10);

  try {
    const [notification] = await sql`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ${notificationId} AND account_id = ${accountId} AND user_id = ${user.id}
      RETURNING *
    `;

    if (!notification) {
      return c.json({ success: false, error: 'Notification not found' }, 404);
    }

    return c.json({ success: true, data: notification });
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});

// PUT /api/notifications/read-all
// Bulk mark-as-read for current user
notificationsRoutes.put('/read-all', async (c) => {
  const user = c.get('user');
  const accountId = user.account_id;

  try {
    await sql`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE account_id = ${accountId} AND user_id = ${user.id} AND read_at IS NULL
    `;

    return c.json({ success: true });
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
  }
});
