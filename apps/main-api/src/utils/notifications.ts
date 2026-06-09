import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import postgres from 'postgres';

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
  const [notification] = (await sql`
    INSERT INTO notifications (
      user_id, account_id, type, title, body, data
    ) VALUES (
      ${userId}, ${accountId}, ${type}, ${title}, ${body}, ${sql.json(data)}
    )
    RETURNING *
  `) as postgres.RowList<postgres.Row[]>;

  // Publish to WS
  await redis.publish(PUB_SUB_CH, JSON.stringify({
    event: 'notification.new',
    data: notification
  }));

  return notification;
};

interface CreateNotificationBatchParams {
  userIds: number[];
  accountId: number;
  type: NotificationType;
  title: string;
  body?: string;
  data?: any;
}

export const createNotificationsBatch = async (params: CreateNotificationBatchParams) => {
  const { userIds, accountId, type, title, body = null, data = {} } = params;
  if (userIds.length === 0) return [];

  const rows = userIds.map(userId => ({
    user_id: userId,
    account_id: accountId,
    type,
    title,
    body,
    data: JSON.stringify(data)
  }));

  // Save to DB in one batch insert query
  const notifications = (await sql`
    INSERT INTO notifications ${sql(rows, 'user_id', 'account_id', 'type', 'title', 'body', 'data')}
    RETURNING *
  `) as postgres.RowList<postgres.Row[]>;

  // Publish to WS in parallel
  await Promise.all(
    notifications.map(notification =>
      redis.publish(PUB_SUB_CH, JSON.stringify({
        event: 'notification.new',
        data: notification
      }))
    )
  );

  return notifications;
};
