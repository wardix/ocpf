import { z } from 'zod';

export const MessageTypeSchema = z.enum([
  'text', 
  'image', 
  'document', 
  'audio', 
  'video', 
  'sticker', 
  'location', 
  'contact', 
  'reaction', 
  'poll', 
  'unknown'
]);

export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MessageStatusSchema = z.enum(['sent', 'delivered', 'read', 'failed']);

export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MediaPayloadSchema = z.object({
  mimetype: z.string(),
  data_base64: z.string(),
  filename: z.string().optional()
});

export const IncomingMessagePayloadSchema = z.object({
  event: z.literal('message.incoming'),
  data: z.object({
    inbox_id: z.number(),
    source_id: z.string(),
    source_jid: z.string(),
    push_name: z.string(),
    content: z.string(),
    message_type: MessageTypeSchema,
    wa_message_id: z.string(),
    timestamp: z.number(),
    participant_id: z.string().nullable().optional(),
    participant_name: z.string().nullable().optional(),
    is_host_echo: z.boolean().optional(),
    media: MediaPayloadSchema.optional()
  })
});

export type IncomingMessagePayload = z.infer<typeof IncomingMessagePayloadSchema>;

export const MessageStatusUpdatePayloadSchema = z.object({
  event: z.literal('message.status_update'),
  data: z.object({
    inbox_id: z.number(),
    wa_message_id: z.string(),
    source_id: z.string(),
    status: MessageStatusSchema,
    timestamp: z.number().optional()
  })
});

export type MessageStatusUpdatePayload = z.infer<typeof MessageStatusUpdatePayloadSchema>;

export const SendMessagePayloadSchema = z.object({
  event: z.literal('message.send'),
  data: z.object({
    inbox_id: z.number(),
    internal_message_id: z.number(),
    target_id: z.string(),
    content: z.string().optional(),
    message_type: MessageTypeSchema,
    is_private: z.boolean().optional(),
    media: MediaPayloadSchema.optional()
  })
});

export type SendMessagePayload = z.infer<typeof SendMessagePayloadSchema>;

export const TypingUpdatePayloadSchema = z.object({
  event: z.literal('typing.update'),
  data: z.object({
    inbox_id: z.number(),
    jid: z.string(),
    is_typing: z.boolean()
  })
});

export type TypingUpdatePayload = z.infer<typeof TypingUpdatePayloadSchema>;

export const SendTypingPayloadSchema = z.object({
  event: z.literal('typing.send'),
  data: z.object({
    inbox_id: z.number(),
    jid: z.string()
  })
});

export type SendTypingPayload = z.infer<typeof SendTypingPayloadSchema>;

export const RedisQueuePayloadSchema = z.discriminatedUnion("event", [
  IncomingMessagePayloadSchema,
  MessageStatusUpdatePayloadSchema,
  SendMessagePayloadSchema,
  TypingUpdatePayloadSchema,
  SendTypingPayloadSchema
]);

export type RedisQueuePayload = z.infer<typeof RedisQueuePayloadSchema>;
