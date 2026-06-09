import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { redis } from '../src/config/redis';
import { websocketHandlers } from '../src/websocket/handler';

describe('Collision Detection Presence Tracking', () => {
  const testConversationId = 9999;
  
  beforeAll(async () => {
    await redis.del(`viewing:conversation:${testConversationId}`);
  });

  afterAll(async () => {
    await redis.del(`viewing:conversation:${testConversationId}`);
  });

  it('should add agent to viewers on conversation.viewing event', async () => {
    // Mock Agent 1
    const mockWs1 = {
      data: {
        accountId: 1,
        userId: 101,
        name: 'Agent Satu',
        role: 'agent',
        isAlive: true
      },
      send: () => {}
    } as any;

    await websocketHandlers.message(mockWs1, JSON.stringify({
      type: 'conversation.viewing',
      conversation_id: testConversationId
    }));

    // Verify key in redis
    const key = `viewing:conversation:${testConversationId}`;
    const members = await redis.zrange(key, 0, -1);
    expect(members.length).toBe(1);
    
    const parsed = JSON.parse(members[0] || '{}');
    expect(parsed.id).toBe(101);
    expect(parsed.name).toBe('Agent Satu');
  });

  it('should support multiple viewers', async () => {
    // Mock Agent 2
    const mockWs2 = {
      data: {
        accountId: 1,
        userId: 102,
        name: 'Agent Dua',
        role: 'agent',
        isAlive: true
      },
      send: () => {}
    } as any;

    await websocketHandlers.message(mockWs2, JSON.stringify({
      type: 'conversation.viewing',
      conversation_id: testConversationId
    }));

    const key = `viewing:conversation:${testConversationId}`;
    const members = await redis.zrange(key, 0, -1);
    expect(members.length).toBe(2);
  });

  it('should remove agent on conversation.left event', async () => {
    const mockWs1 = {
      data: {
        accountId: 1,
        userId: 101,
        name: 'Agent Satu',
        role: 'agent',
        isAlive: true
      },
      send: () => {}
    } as any;

    await websocketHandlers.message(mockWs1, JSON.stringify({
      type: 'conversation.left',
      conversation_id: testConversationId
    }));

    const key = `viewing:conversation:${testConversationId}`;
    const members = await redis.zrange(key, 0, -1);
    expect(members.length).toBe(1);

    const parsed = JSON.parse(members[0] || '{}');
    expect(parsed.id).toBe(102);
  });

  it('should remove agent immediately on websocket close if they were viewing', async () => {
    const mockWs2 = {
      data: {
        accountId: 1,
        userId: 102,
        name: 'Agent Dua',
        role: 'agent',
        isAlive: true,
        viewingConversationId: testConversationId
      },
      send: () => {}
    } as any;

    await websocketHandlers.close(mockWs2);

    const key = `viewing:conversation:${testConversationId}`;
    const members = await redis.zrange(key, 0, -1);
    expect(members.length).toBe(0);
  });
});
