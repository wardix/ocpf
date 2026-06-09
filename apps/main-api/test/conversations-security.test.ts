import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { conversationsRoutes } from '../src/routes/conversations';
import crypto from 'crypto';

describe('Conversations Route Security (Multi-Tenancy Time-Travel Verification)', () => {
  let tenant1Id: number;
  let tenant2Id: number;
  let user1Id: number;
  let user2Id: number;
  
  let tenant1Key: string;
  let tenant2Key: string;
  
  let tenant1ConvId: number;
  let tenant2ConvId: number;
  
  let tenant1TicketId: number;
  let tenant2TicketId: number;
  
  let tenant1MsgId: number;
  let tenant2MsgId: number;

  beforeAll(async () => {
    // Reset sequences to prevent duplicate key constraint issues
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;
    await sql`SELECT setval('contacts_id_seq', COALESCE((SELECT MAX(id) FROM contacts), 1), true)`;
    await sql`SELECT setval('conversations_id_seq', COALESCE((SELECT MAX(id) FROM conversations), 1), true)`;
    await sql`SELECT setval('tickets_id_seq', COALESCE((SELECT MAX(id) FROM tickets), 1), true)`;
    await sql`SELECT setval('messages_id_seq', COALESCE((SELECT MAX(id) FROM messages), 1), true)`;
    await sql`SELECT setval('api_keys_id_seq', COALESCE((SELECT MAX(id) FROM api_keys), 1), true)`;

    // 1. Create Tenant 1 and Tenant 2 Accounts
    const [t1] = await sql`INSERT INTO accounts (name) VALUES ('Security Test Tenant 1') RETURNING id`;
    tenant1Id = Number(t1.id);
    
    const [t2] = await sql`INSERT INTO accounts (name) VALUES ('Security Test Tenant 2') RETURNING id`;
    tenant2Id = Number(t2.id);

    // 2. Create Users for the Tenants (needed for api_keys.created_by)
    const email1 = `user1_${crypto.randomBytes(4).toString('hex')}@tenant1.local`;
    const [u1] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Tenant 1 User', ${email1}, 'dummy_hash')
      RETURNING id
    `;
    user1Id = Number(u1.id);

    const email2 = `user2_${crypto.randomBytes(4).toString('hex')}@tenant2.local`;
    const [u2] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Tenant 2 User', ${email2}, 'dummy_hash')
      RETURNING id
    `;
    user2Id = Number(u2.id);

    // 3. Create API Keys for Authentication
    tenant1Key = 'tok_t1_' + crypto.randomBytes(16).toString('hex');
    const tenant1Hash = crypto.createHash('sha256').update(tenant1Key).digest('hex');
    await sql`
      INSERT INTO api_keys (account_id, key_hash, key_prefix, name, permissions, created_by)
      VALUES (${tenant1Id}, ${tenant1Hash}, 'tok_t1', 'T1 Key', ARRAY['conversations.read']::text[], ${user1Id})
    `;

    tenant2Key = 'tok_t2_' + crypto.randomBytes(16).toString('hex');
    const tenant2Hash = crypto.createHash('sha256').update(tenant2Key).digest('hex');
    await sql`
      INSERT INTO api_keys (account_id, key_hash, key_prefix, name, permissions, created_by)
      VALUES (${tenant2Id}, ${tenant2Hash}, 'tok_t2', 'T2 Key', ARRAY['conversations.read']::text[], ${user2Id})
    `;

    // 4. Setup Tenant 1 Structure (Channel, Inbox, Contact, Conversation)
    const [c1] = await sql`INSERT INTO channels (account_id, name, provider_type, provider_config) VALUES (${tenant1Id}, 'C1', 'whatsapp', '{}') RETURNING id`;
    const [i1] = await sql`INSERT INTO inboxes (account_id, channel_id, name) VALUES (${tenant1Id}, ${c1.id}, 'I1') RETURNING id`;
    const [con1] = await sql`INSERT INTO contacts (account_id, name, phone_number) VALUES (${tenant1Id}, 'Contact 1', '1111111') RETURNING id`;
    const [conv1] = await sql`INSERT INTO conversations (account_id, inbox_id, contact_id) VALUES (${tenant1Id}, ${i1.id}, ${con1.id}) RETURNING id`;
    tenant1ConvId = Number(conv1.id);

    // 5. Setup Tenant 2 Structure (Channel, Inbox, Contact, Conversation)
    const [c2] = await sql`INSERT INTO channels (account_id, name, provider_type, provider_config) VALUES (${tenant2Id}, 'C2', 'whatsapp', '{}') RETURNING id`;
    const [i2] = await sql`INSERT INTO inboxes (account_id, channel_id, name) VALUES (${tenant2Id}, ${c2.id}, 'I2') RETURNING id`;
    const [con2] = await sql`INSERT INTO contacts (account_id, name, phone_number) VALUES (${tenant2Id}, 'Contact 2', '2222222') RETURNING id`;
    const [conv2] = await sql`INSERT INTO conversations (account_id, inbox_id, contact_id) VALUES (${tenant2Id}, ${i2.id}, ${con2.id}) RETURNING id`;
    tenant2ConvId = Number(conv2.id);

    // 6. Setup Tenant 2 Ticket and Message (Inserted first so it gets a smaller message ID)
    const [ticket2] = await sql`INSERT INTO tickets (account_id, conversation_id, status) VALUES (${tenant2Id}, ${tenant2ConvId}, 'open') RETURNING id`;
    tenant2TicketId = Number(ticket2.id);
    const [msg2] = await sql`
      INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, content, message_type)
      VALUES (${tenant2Id}, ${tenant2ConvId}, ${tenant2TicketId}, 'Contact', 'Tenant 2 Message', 'incoming')
      RETURNING id
    `;
    tenant2MsgId = Number(msg2.id);

    // 7. Setup Tenant 1 Ticket and Message (Inserted second so it gets a larger message ID)
    const [ticket1] = await sql`INSERT INTO tickets (account_id, conversation_id, status) VALUES (${tenant1Id}, ${tenant1ConvId}, 'open') RETURNING id`;
    tenant1TicketId = Number(ticket1.id);
    const [msg1] = await sql`
      INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, content, message_type)
      VALUES (${tenant1Id}, ${tenant1ConvId}, ${tenant1TicketId}, 'Contact', 'Tenant 1 Message', 'incoming')
      RETURNING id
    `;
    tenant1MsgId = Number(msg1.id);

    // Guarantee that Tenant 1 message ID is indeed larger than Tenant 2 message ID for the vulnerability test scenario
    expect(tenant1MsgId).toBeGreaterThan(tenant2MsgId);
  });

  afterAll(async () => {
    // Cleanup everything created for the security test
    if (tenant1Id || tenant2Id) {
      const ids = [tenant1Id, tenant2Id].filter(Boolean);
      await sql`DELETE FROM messages WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM tickets WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM conversations WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM contacts WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM inboxes WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM channels WHERE account_id = ANY(${ids})`;
      await sql`DELETE FROM api_keys WHERE account_id = ANY(${ids})`;
      if (user1Id || user2Id) {
        const uids = [user1Id, user2Id].filter(Boolean);
        await sql`DELETE FROM users WHERE id = ANY(${uids})`;
      }
      await sql`DELETE FROM accounts WHERE id = ANY(${ids})`;
    }
  });

  it('should return Tenant 1 message when querying Tenant 1 conversation with tenant2TicketId', async () => {
    // Tenant 1 makes a request to fetch messages from their own conversation (tenant1ConvId)
    // but tries to perform time-travel using Tenant 2's ticket (tenant2TicketId)
    const response = await conversationsRoutes.request(`/${tenant1ConvId}/messages?ticket_id=${tenant2TicketId}`, {
      headers: {
        'X-API-Key': tenant1Key,
      },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    
    // Verify that the response contains Tenant 1's message.
    // If the vulnerability was present, the endpoint would query `SELECT MAX(id) FROM messages WHERE ticket_id = ${tenant2TicketId}`
    // which would return tenant2MsgId. Since tenant1MsgId > tenant2MsgId, Tenant 1's message would be filtered out,
    // resulting in an empty or filtered list.
    // Because of the AND account_id = ${accountId} filter, MAX(id) is null, maxMessageId defaults to 999999999,
    // and Tenant 1's message is correctly returned.
    expect(data.length).toBeGreaterThan(0);
    expect(Number(data[0].id)).toBe(tenant1MsgId);
    expect(data[0].content).toBe('Tenant 1 Message');
  });

  it('should restrict message results when querying Tenant 1 conversation with own tenant1TicketId', async () => {
    // Verify that using its own ticket ID restricts messages as expected
    const response = await conversationsRoutes.request(`/${tenant1ConvId}/messages?ticket_id=${tenant1TicketId}`, {
      headers: {
        'X-API-Key': tenant1Key,
      },
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBeGreaterThan(0);
    expect(Number(data[0].id)).toBe(tenant1MsgId);
    expect(data[0].content).toBe('Tenant 1 Message');
  });
});
