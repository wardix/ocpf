import * as Sentry from '@sentry/bun';
import pino from 'pino';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development'
  });
  console.log('[Telegram Adapter] Sentry initialized');
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
});

process.on('unhandledRejection', (reason) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(reason);
  }
  logger.error({ msg: 'Unhandled Rejection', error: reason });
});

process.on('uncaughtException', (error) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error);
  }
  logger.error({ msg: 'Uncaught Exception', error: error.message || error });
});

import { Bot, InputFile } from 'grammy';
import Redis from 'ioredis';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/omnichannel';

const redis = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
const redisSub = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
const sql = postgres(DATABASE_URL);

interface ChannelInbox {
  channel_id: number;
  inbox_id: number;
  token: string;
}

const activeBots = new Map<number, Bot>(); // inbox_id -> Bot
const activeWorkers = new Map<number, boolean>(); // inbox_id -> boolean

const QUEUE_INCOMING = 'queue:incoming_messages';

async function startBotForInbox(inboxId: number, token: string) {
  if (activeBots.has(inboxId)) return;

  logger.info(`[Inbox ${inboxId}] Starting Telegram Bot...`);
  const bot = new Bot(token);
  activeBots.set(inboxId, bot);

  // Error handling
  bot.catch((err) => {
    logger.error({ msg: `[Inbox ${inboxId}] Bot error`, error: err });
  });

  // Handle incoming messages
  bot.on('message', async (ctx) => {
    const msg = ctx.message;
    if (!msg) return;

    let content = msg.text || msg.caption || '';
    let messageType = 'text';
    let mediaData = null;

    if (msg.photo) {
      messageType = 'image';
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const file = await ctx.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        mediaData = {
          mimetype: 'image/jpeg',
          data_base64: buffer.toString('base64'),
          filename: 'photo.jpg'
        };
      } catch (err) {
        logger.error({ msg: 'Failed to download telegram photo', error: err });
      }
    } else if (msg.document) {
      messageType = 'document';
      try {
        const file = await ctx.api.getFile(msg.document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        mediaData = {
          mimetype: msg.document.mime_type || 'application/octet-stream',
          data_base64: buffer.toString('base64'),
          filename: msg.document.file_name || 'document.bin'
        };
      } catch (err) {
        logger.error({ msg: 'Failed to download telegram document', error: err });
      }
    } else if (msg.video) {
      messageType = 'video';
      try {
        const file = await ctx.api.getFile(msg.video.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        mediaData = {
          mimetype: msg.video.mime_type || 'video/mp4',
          data_base64: buffer.toString('base64'),
          filename: 'video.mp4'
        };
      } catch (e) {}
    } else if (msg.location) {
      messageType = 'location';
      content = `Lokasi: https://maps.google.com/?q=${msg.location.latitude},${msg.location.longitude}`;
    }

    const payload = {
      event: 'message.incoming',
      data: {
        inbox_id: inboxId,
        source_id: `tg_${msg.chat.id}`,
        contact_name: msg.from?.first_name 
          ? `${msg.from.first_name} ${msg.from.last_name || ''}`.trim() 
          : `Telegram User ${msg.chat.id}`,
        content: content,
        message_type: messageType,
        media: mediaData,
        timestamp: msg.date * 1000
      }
    };

    await redis.rpush(QUEUE_INCOMING, JSON.stringify(payload));
  });

  bot.start({
    drop_pending_updates: false,
    allowed_updates: ['message']
  });
  
  // Start outgoing worker
  activeWorkers.set(inboxId, true);
  startOutgoingWorker(inboxId, bot);
}

async function startOutgoingWorker(inboxId: number, bot: Bot) {
  const queueName = `queue:outgoing_messages:inbox_${inboxId}`;
  const redisWorker = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

  logger.info(`[Inbox ${inboxId}] Outgoing worker started listening on ${queueName}`);

  while (activeWorkers.get(inboxId)) {
    try {
      const result = await redisWorker.brpop(queueName, 5); // 5 seconds timeout
      if (!result) continue;

      const [_, payloadStr] = result;
      const payload = JSON.parse(payloadStr);

      if (payload.event === 'message.send') {
        const data = payload.data;
        const chatId = data.target_id.replace('tg_', '');

        if (data.media) {
          const buffer = Buffer.from(data.media.data_base64, 'base64');
          const inputFile = new InputFile(buffer, data.media.filename || 'file');

          if (data.media.mimetype.startsWith('image/')) {
            await bot.api.sendPhoto(chatId, inputFile, { caption: data.content });
          } else if (data.media.mimetype.startsWith('video/')) {
            await bot.api.sendVideo(chatId, inputFile, { caption: data.content });
          } else {
            await bot.api.sendDocument(chatId, inputFile, { caption: data.content });
          }
        } else {
          await bot.api.sendMessage(chatId, data.content);
        }

        // Notify success status back to main-api
        await redis.rpush('queue:message_status_updates', JSON.stringify({
          event: 'message.status.update',
          data: {
            internal_message_id: data.internal_message_id,
            status: 'delivered',
            timestamp: Date.now()
          }
        }));
      }
    } catch (err) {
      logger.error({ msg: `[Inbox ${inboxId}] Error sending outgoing message`, error: err });
    }
  }

  redisWorker.quit();
}

async function syncChannels() {
  logger.info('Syncing Telegram channels...');
  try {
    const channels = await sql`
      SELECT ch.id as channel_id, ch.provider_config->>'token' as token, i.id as inbox_id
      FROM channels ch
      JOIN inboxes i ON i.channel_id = ch.id
      WHERE ch.provider_type = 'telegram' AND i.is_active = true
    `;

    const activeInboxIds = new Set(channels.map((c: any) => c.inbox_id));

    // Stop bots for deleted/inactive inboxes
    for (const [inboxId, bot] of activeBots.entries()) {
      if (!activeInboxIds.has(inboxId)) {
        logger.info(`[Inbox ${inboxId}] Stopping Telegram Bot...`);
        bot.stop();
        activeBots.delete(inboxId);
        activeWorkers.set(inboxId, false);
      }
    }

    // Start bots for new inboxes
    for (const channel of channels) {
      if (channel.token) {
        startBotForInbox(channel.inbox_id, channel.token);
      }
    }
  } catch (err) {
    logger.error({ msg: 'Failed to sync channels', error: err });
  }
}

// Redis Pub/Sub listener to refresh channels when a new channel is added
redisSub.subscribe('system:telegram:refresh_channels');
redisSub.on('message', (channel, message) => {
  if (channel === 'system:telegram:refresh_channels') {
    syncChannels();
  }
});

// Initial Sync
syncChannels();

logger.info('Telegram Adapter started. Waiting for channels...');