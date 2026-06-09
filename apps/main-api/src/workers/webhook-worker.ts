import { redis, redisWebhookWorker } from '../config/redis';
import { sql } from '../config/database';
import crypto from 'crypto';

export async function startWebhookWorker() {
  console.log('Webhook Worker: Berjalan (Siap memproses antrean queue:webhook_deliveries)');
  
  // Start the scheduler that polls the Redis Sorted Set for delayed retries
  startDelayedRetryScheduler();

  while (!(globalThis as any).isShuttingDown) {
    try {
      // FIX: Use dedicated redisWebhookWorker connection for blocking BRPOP
      const result = await redisWebhookWorker.brpop('queue:webhook_deliveries', 0);
      if (result) {
        const [_, taskStr] = result;
        const task = JSON.parse(taskStr);
        await deliverWebhook(task);
      }
    } catch (e) {
      if ((globalThis as any).isShuttingDown) {
        break;
      }
      console.error('Error in Webhook Worker loop:', e);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function deliverWebhook(task: {
  webhookId: number;
  url: string;
  secret: string;
  eventType: string;
  payload: any;
  attempt: number;
}) {
  const payloadStr = JSON.stringify(task.payload);
  const signature = crypto.createHmac('sha256', task.secret).update(payloadStr).digest('hex');

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let deliveredAt: Date | null = null;
  let shouldRetry = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(task.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': task.eventType
      },
      body: payloadStr,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    responseStatus = response.status;
    responseBody = await response.text();

    if (response.status >= 200 && response.status < 300) {
      deliveredAt = new Date();
      console.log(`[Webhook Worker] Successfully delivered ${task.eventType} to ${task.url} (Webhook #${task.webhookId})`);
    } else {
      // 5xx status codes trigger retries
      errorMessage = `HTTP Error status: ${response.status}`;
      if (response.status >= 500) {
        shouldRetry = true;
      }
    }
  } catch (error: any) {
    errorMessage = error.name === 'AbortError' ? 'Request Timeout (10s)' : error.message;
    shouldRetry = true; // Connection errors / timeouts trigger retries
    console.error(`[Webhook Worker] Error delivering webhook #${task.webhookId} to ${task.url}:`, errorMessage);
  }

  try {
    // Write log to DB
    await sql`
      INSERT INTO webhook_delivery_logs (
        webhook_id, event_type, payload, response_status, response_body, attempt, delivered_at, error_message
      ) VALUES (
        ${task.webhookId}, ${task.eventType}, ${task.payload}, ${responseStatus}, ${responseBody}, ${task.attempt}, ${deliveredAt}, ${errorMessage}
      )
    `;
  } catch (dbErr) {
    console.error('[Webhook Worker] Failed to write delivery log to DB:', dbErr);
  }

  // Handle retry logic if needed and maximum attempts (3) is not exceeded
  if (shouldRetry && task.attempt < 3) {
    const nextAttempt = task.attempt + 1;
    const delaySeconds = Math.pow(2, task.attempt) * 10; // 10s, 20s
    const runAt = Date.now() + delaySeconds * 1000;

    const retryTask = {
      ...task,
      attempt: nextAttempt
    };

    try {
      await redis.zadd('delayed:webhook_deliveries', runAt, JSON.stringify(retryTask));
      console.log(`[Webhook Worker] Scheduled retry attempt ${nextAttempt} for webhook #${task.webhookId} in ${delaySeconds}s (at ${new Date(runAt).toISOString()})`);
    } catch (redisErr) {
      console.error('[Webhook Worker] Failed to schedule retry in Redis Sorted Set:', redisErr);
    }
  }
}

function startDelayedRetryScheduler() {
  setInterval(async () => {
    if ((globalThis as any).isShuttingDown) return;
    try {
      const now = Date.now();
      const tasks = await redis.zrangebyscore('delayed:webhook_deliveries', 0, now);
      
      if (tasks.length > 0) {
        for (const taskStr of tasks) {
          const removed = await redis.zrem('delayed:webhook_deliveries', taskStr);
          if (removed) {
            await redis.lpush('queue:webhook_deliveries', taskStr);
          }
        }
      }
    } catch (error) {
      console.error('[Webhook Delayed Scheduler] Error processing retries:', error);
    }
  }, 5000); // Poll every 5s
}
