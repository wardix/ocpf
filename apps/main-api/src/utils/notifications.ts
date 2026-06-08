import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';

export type NotificationType = 'conversation_assigned' | 'mentioned_in_note' | 'snoozed_ticket_due' | 'broadcast_completed' | 'new_conversation';

interface CreateNotificationParams {
  userId: number;
  accountId: number;
  type: NotificationType;
  title: string;
  body?: string;
  data?: any;
}

export const createNotification = async (params: CreateNotificationParams) => {
  const { userId, accountId, type, title, body = null, data = {} } = params;

  // Save to DB
  const [notification] = await sql`
    INSERT INTO notifications (
      user_id, account_id, type, title, body, data
    ) VALUES (
      ${userId}, ${accountId}, ${type}, ${title}, ${body}, ${sql.json(data)}
    )
    RETURNING *
  `;

  // Publish to WS
  await redis.publish(PUB_SUB_CH, JSON.stringify({
    event: 'notification.new',
    data: notification
  }));

  return notification;
};
