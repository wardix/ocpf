import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { sql } from '../src/config/database';
import { redis } from '../src/config/redis';
import { evaluateAutomationRules } from '../src/utils/automation';

describe('Automation Rules Engine Helpers & Evaluation', () => {
  const testAccountId = 1;
  const testUserId = 1;
  let ruleIds: number[] = [];
  let testConvId: number;
  let testTicketId: number;

  beforeAll(async () => {
    // Clean up any stale rules and logs for test account
    await sql`DELETE FROM automation_rules WHERE account_id = ${testAccountId}`;
    await sql`DELETE FROM automation_logs WHERE account_id = ${testAccountId}`;

    // 1. Create a test contact & conversation & active ticket
    const [contact] = await sql`
      INSERT INTO contacts (account_id, name, phone_number)
      VALUES (${testAccountId}, 'Test Automation Contact', '628999999999')
      RETURNING id
    `;

    const [conv] = await sql`
      INSERT INTO conversations (account_id, inbox_id, contact_id)
      VALUES (${testAccountId}, 1, ${contact.id})
      RETURNING id
    `;
    testConvId = Number(conv.id);

    const [ticket] = await sql`
      INSERT INTO tickets (account_id, conversation_id, status)
      VALUES (${testAccountId}, ${conv.id}, 'open')
      RETURNING id
    `;
    testTicketId = Number(ticket.id);
  });

  afterAll(async () => {
    // Clean up test data
    if (ruleIds.length > 0) {
      await sql`DELETE FROM automation_rules WHERE id = ANY(${ruleIds})`;
    }
    await sql`DELETE FROM conversations WHERE id = ${testConvId}`;
    await sql`DELETE FROM contacts WHERE phone_number = '628999999999'`;
  });

  it('should trigger send_reply and change_status actions on matching incoming message (exact match)', async () => {
    // Insert automation rule for exact keyword match
    const triggerConfig = { keywords: ['ping'], match_type: 'exact' };
    const actions = [
      { type: 'send_reply', content: 'pong' },
      { type: 'change_status', status: 'pending' }
    ];

    const [rule] = await sql`
      INSERT INTO automation_rules (
        account_id, name, trigger_type, trigger_config, actions, is_active, priority, created_by
      ) VALUES (
        ${testAccountId}, 'Exact Match Rule', 'message.incoming', ${sql.json(triggerConfig)}, ${actions.map(a => JSON.stringify(a))}::jsonb[], true, 0, ${testUserId}
      )
      RETURNING id
    `;
    ruleIds.push(Number(rule.id));

    // Mock incoming message
    const msg = {
      account_id: testAccountId,
      conversation_id: testConvId,
      ticket_id: testTicketId,
      content: 'ping',
      sender_type: 'Contact'
    };

    await evaluateAutomationRules(testAccountId, 'message.incoming', msg);

    // Verify status changed to pending
    const [updatedTicket] = await sql`
      SELECT status FROM tickets WHERE id = ${testTicketId}
    `;
    expect(updatedTicket.status).toBe('pending');

    // Verify reply message is stored in database
    const replies = await sql`
      SELECT content FROM messages
      WHERE conversation_id = ${testConvId} AND sender_type = 'System' AND content = 'pong'
    `;
    expect(replies.length).toBe(1);

    // Verify log is written
    const logs = await sql`
      SELECT * FROM automation_logs WHERE rule_id = ${rule.id}
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('success');
  });

  it('should trigger status.changed automation rules', async () => {
    // Create rule triggered by status change from pending -> resolved
    const triggerConfig = { from_status: 'pending', to_status: 'resolved' };
    const actions = [
      { type: 'send_reply', content: 'Tiket ini telah ditutup oleh sistem.' }
    ];

    const [rule] = await sql`
      INSERT INTO automation_rules (
        account_id, name, trigger_type, trigger_config, actions, is_active, priority, created_by
      ) VALUES (
        ${testAccountId}, 'Status Change Rule', 'status.changed', ${sql.json(triggerConfig)}, ${actions.map(a => JSON.stringify(a))}::jsonb[], true, 0, ${testUserId}
      )
      RETURNING id
    `;
    ruleIds.push(Number(rule.id));

    await evaluateAutomationRules(testAccountId, 'status.changed', {
      conversationId: testConvId,
      ticketId: testTicketId,
      previousStatus: 'pending',
      newStatus: 'resolved'
    });

    const logs = await sql`
      SELECT * FROM automation_logs WHERE rule_id = ${rule.id}
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe('success');
  });
});
