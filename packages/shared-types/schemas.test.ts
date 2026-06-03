import { describe, it, expect } from 'bun:test';
import { 
  IncomingMessagePayloadSchema, 
  SendMessagePayloadSchema, 
  RedisQueuePayloadSchema 
} from './index';

describe('Shared Types Zod Schemas', () => {
  it('should validate a correct IncomingMessagePayload', () => {
    const validPayload = {
      event: 'message.incoming',
      data: {
        inbox_id: 1,
        source_id: '62812345678',
        source_jid: '62812345678@s.whatsapp.net',
        push_name: 'John Doe',
        content: 'Halo',
        message_type: 'text',
        wa_message_id: 'ABCDEF123456',
        timestamp: 1690000000,
        is_host_echo: false
      }
    };

    const result = IncomingMessagePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('should reject IncomingMessagePayload with missing required fields', () => {
    const invalidPayload = {
      event: 'message.incoming',
      data: {
        inbox_id: 1,
        // source_id missing
        source_jid: '62812345678@s.whatsapp.net',
        push_name: 'John Doe',
        content: 'Halo',
        message_type: 'text',
        wa_message_id: 'ABCDEF123456',
        timestamp: 1690000000
      }
    };

    const result = IncomingMessagePayloadSchema.safeParse(invalidPayload);
    expect(result.success).toBe(false);
  });

  it('should validate SendMessagePayload correctly through discriminated union', () => {
    const validPayload = {
      event: 'message.send',
      data: {
        inbox_id: 2,
        internal_message_id: 500,
        target_id: '62812345678@s.whatsapp.net',
        content: 'Hello Back!',
        message_type: 'text',
        is_private: false
      }
    };

    const result = RedisQueuePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});
