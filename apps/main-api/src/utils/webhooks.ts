import { sql } from '../config/database';
import { redis } from '../config/redis';

export async function dispatchWebhook(accountId: number, eventType: string, payload: any) {
  try {
    const activeWebhooks = await sql`
      SELECT id, url, secret FROM webhooks
      WHERE account_id = ${accountId} AND active = true AND ${eventType} = ANY(events)
    `;

    if (activeWebhooks.length === 0) return;

    for (const webhook of activeWebhooks) {
      const task = {
        webhookId: Number(webhook.id),
        url: webhook.url,
        secret: webhook.secret,
        eventType,
        payload,
        attempt: 1
      };
      
      await redis.lpush('queue:webhook_deliveries', JSON.stringify(task));
    }
    console.log(`[Webhook Dispatcher] Dispatched event ${eventType} for Account ${accountId} to ${activeWebhooks.length} webhooks.`);
  } catch (error) {
    console.error(`[Webhook Dispatcher] Failed to dispatch event ${eventType} for Account ${accountId}:`, error);
  }
}
