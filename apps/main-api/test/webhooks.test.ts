import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { redis } from '../src/config/redis';
import { dispatchWebhook } from '../src/utils/webhooks';

describe('Outbound Webhooks System', () => {
  const testAccountId = 1;
  let testWebhookId: number;

  beforeAll(async () => {
    // Ensure Account 1 exists
    await sql`INSERT INTO accounts (id, name) VALUES (${testAccountId}, 'Default Test Account') ON CONFLICT (id) DO NOTHING`;

    // Reset sequence just in case
    await sql`SELECT setval('webhooks_id_seq', COALESCE((SELECT MAX(id) FROM webhooks), 1), true)`;
  });

  afterAll(async () => {
    // Clean up test webhooks
    if (testWebhookId) {
      await sql`DELETE FROM webhooks WHERE id = ${testWebhookId}`;
    }
  });

  it('should ignore events if no active webhook matches the event type', async () => {
    // Clear the Redis queue before test
    await redis.del('queue:webhook_deliveries');

    await dispatchWebhook(testAccountId, 'contact.created', { id: 123, name: 'Ignored Contact' });

    const queueLen = await redis.llen('queue:webhook_deliveries');
    expect(queueLen).toBe(0);
  });

  it('should push a task to Redis queue when a matching active webhook is found', async () => {
    // Insert a test webhook matching contact.created
    const [webhook] = await sql`
      INSERT INTO webhooks (account_id, url, events, secret, active, description)
      VALUES (${testAccountId}, 'https://mock.httpbin.org/post', ARRAY['contact.created', 'message.incoming'], 'test_secret_key_123', true, 'Test Webhook')
      RETURNING id
    `;
    testWebhookId = Number(webhook.id);

    // Clear queue
    await redis.del('queue:webhook_deliveries');

    // Dispatch matching event
    const contactPayload = { id: 999, name: 'Triggered Contact' };
    await dispatchWebhook(testAccountId, 'contact.created', contactPayload);

    // Verify task is pushed or processed
    // Because the background worker might consume it instantly, we check both the database logs and the queue.
    let logFound = null;
    for (let i = 0; i < 20; i++) {
      const logs = await sql`
        SELECT * FROM webhook_delivery_logs WHERE webhook_id = ${testWebhookId}
      `;
      if (logs.length > 0) {
        logFound = logs[0];
        break;
      }
      const queueLen = await redis.llen('queue:webhook_deliveries');
      if (queueLen > 0) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (logFound) {
      expect(logFound.event_type).toBe('contact.created');
      expect(logFound.payload.name).toBe('Triggered Contact');
    } else {
      const queueLen = await redis.llen('queue:webhook_deliveries');
      expect(queueLen).toBe(1);

      const taskStr = await redis.rpop('queue:webhook_deliveries');
      expect(taskStr).not.toBeNull();
      
      const task = JSON.parse(taskStr!);
      expect(task.webhookId).toBe(testWebhookId);
      expect(task.url).toBe('https://mock.httpbin.org/post');
      expect(task.eventType).toBe('contact.created');
      expect(task.payload.name).toBe('Triggered Contact');
      expect(task.secret).toBe('test_secret_key_123');
    }
  });
});
