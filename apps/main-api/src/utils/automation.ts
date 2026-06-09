import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import { dispatchWebhook } from './webhooks';

export async function evaluateAutomationRules(
  accountId: number,
  triggerType: 'message.incoming' | 'ticket.idle' | 'status.changed' | 'contact.created',
  triggerData: any
) {
  const tStart = Date.now();
  console.log(`[Automation Engine] Evaluating rules for Account ${accountId}, trigger: ${triggerType}`);

  try {
    // 1. Fetch active rules sorted by priority ASC
    const activeRules = await sql`
      SELECT * FROM automation_rules
      WHERE account_id = ${accountId} AND is_active = true
      AND trigger_type = ${triggerType}
      ORDER BY priority ASC, id ASC
    `;

    if (activeRules.length === 0) return;

    for (const rule of activeRules) {
      let isMatch = false;
      const config = rule.trigger_config || {};

      // 2. Evaluate trigger match
      if (triggerType === 'message.incoming') {
        const message = triggerData; // message object { content: string, conversation_id: number }
        const content = (message.content || '').trim();
        
        const keywords = config.keywords || [];
        const matchType = config.match_type || 'contains';

        if (keywords.length === 0) {
          isMatch = true;
        } else {
          isMatch = keywords.some((kw: string) => {
            if (matchType === 'exact') {
              return content.toLowerCase() === kw.toLowerCase();
            } else if (matchType === 'contains') {
              return content.toLowerCase().includes(kw.toLowerCase());
            } else if (matchType === 'regex') {
              try {
                const regex = new RegExp(kw, 'i');
                return regex.test(content);
              } catch (e) {
                console.error(`Invalid regex: ${kw}`, e);
                return false;
              }
            }
            return false;
          });
        }
      } else if (triggerType === 'contact.created') {
        const contact = triggerData;
        const keywords = config.keywords || [];
        const matchType = config.match_type || 'contains';

        if (keywords.length === 0) {
          isMatch = true;
        } else {
          const name = contact.name || '';
          isMatch = keywords.some((kw: string) => {
            if (matchType === 'exact') {
              return name.toLowerCase() === kw.toLowerCase();
            } else if (matchType === 'contains') {
              return name.toLowerCase().includes(kw.toLowerCase());
            } else if (matchType === 'regex') {
              try {
                const regex = new RegExp(kw, 'i');
                return regex.test(name);
              } catch (e) {
                return false;
              }
            }
            return false;
          });
        }
      } else if (triggerType === 'status.changed') {
        const { previousStatus, newStatus } = triggerData;
        const fromStatus = config.from_status;
        const toStatus = config.to_status;

        const fromMatch = !fromStatus || fromStatus === previousStatus;
        const toMatch = !toStatus || toStatus === newStatus;

        isMatch = fromMatch && toMatch;
      } else if (triggerType === 'ticket.idle') {
        isMatch = true;
      }

      if (!isMatch) continue;

      console.log(`[Automation Engine] Rule matched: "${rule.name}" (ID: ${rule.id})`);

      const actionsExecuted: any[] = [];
      const actionsFailed: any[] = [];
      let executionStatus = 'success';

      let conversationId = triggerData.conversation_id || triggerData.conversationId || null;
      let ticketId = triggerData.ticket_id || triggerData.ticketId || null;

      if (triggerType === 'message.incoming') {
        conversationId = triggerData.conversation_id;
        ticketId = triggerData.ticket_id;
      }

      // Execute actions sequentially
      for (const rawAction of rule.actions) {
        const action = typeof rawAction === 'string' ? JSON.parse(rawAction) : rawAction;
        try {
          if (action.type === 'add_label') {
            if (!conversationId) throw new Error('Conversation ID is missing for add_label action');
            const labelId = action.label_id;
            
            // Insert label if it doesn't exist
            await sql`
              INSERT INTO conversation_labels (conversation_id, label_id)
              VALUES (${conversationId}, ${labelId})
              ON CONFLICT DO NOTHING
            `;

            // Fetch the label details to publish
            const [label] = await sql`
              SELECT * FROM labels WHERE id = ${labelId}
            `;

            if (label) {
              await redis.publish(PUB_SUB_CH, JSON.stringify({
                event: 'conversation.label_added',
                data: { conversation_id: conversationId, label }
              }));
            }

            actionsExecuted.push(action);
          } else if (action.type === 'assign_agent') {
            if (!conversationId) throw new Error('Conversation ID is missing for assign_agent action');
            const agentId = action.agent_id;

            // Find or create active ticket for this conversation to assign
            let [ticket] = await sql`
              SELECT id FROM tickets WHERE conversation_id = ${conversationId} AND status != 'resolved' LIMIT 1
            `;

            if (!ticket) {
              [ticket] = await sql`
                INSERT INTO tickets (account_id, conversation_id, assignee_id, status)
                VALUES (${accountId}, ${conversationId}, ${agentId}, 'open')
                RETURNING id
              `;
            } else {
              await sql`
                UPDATE tickets
                SET assignee_id = ${agentId}, updated_at = NOW()
                WHERE id = ${ticket.id}
              `;
            }

            // Update conversation assignee
            await sql`
              UPDATE conversations
              SET updated_at = NOW()
              WHERE id = ${conversationId}
            `;

            const [updatedConv] = await sql`
              SELECT c.*, t.assignee_id, u.name as assignee_name
              FROM conversations c
              LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
              LEFT JOIN users u ON t.assignee_id = u.id
              WHERE c.id = ${conversationId} LIMIT 1
            `;

            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'conversation.updated',
              data: updatedConv
            }));

            const [agent] = await sql`SELECT name FROM users WHERE id = ${agentId}`;
            const systemMsgContent = agent ? `Tiket ditugaskan otomatis oleh sistem ke ${agent.name}.` : 'Tiket ditugaskan otomatis oleh sistem.';
            
            const [systemMsg] = await sql`
              INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, content, message_type)
              VALUES (${accountId}, ${conversationId}, ${ticket.id}, 'System', ${systemMsgContent}, 'outgoing')
              RETURNING *
            `;

            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'message.new',
              data: systemMsg
            }));

            actionsExecuted.push(action);
          } else if (action.type === 'change_status') {
            if (!conversationId) throw new Error('Conversation ID is missing for change_status action');
            const newStatus = action.status;

            let [ticket] = await sql`
              SELECT id, status FROM tickets WHERE conversation_id = ${conversationId} AND status != 'resolved' LIMIT 1
            `;

            if (ticket) {
              await sql`
                UPDATE tickets
                SET status = ${newStatus}, updated_at = NOW(), resolved_at = ${newStatus === 'resolved' ? sql`NOW()` : null}
                WHERE id = ${ticket.id}
              `;
            } else {
              [ticket] = await sql`
                INSERT INTO tickets (account_id, conversation_id, status, resolved_at)
                VALUES (${accountId}, ${conversationId}, ${newStatus}, ${newStatus === 'resolved' ? sql`NOW()` : null})
                RETURNING id, status
              `;
            }

            const systemMsgContent = `Status percakapan diubah otomatis oleh sistem menjadi ${newStatus}.`;
            const [systemMsg] = await sql`
              INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, content, message_type)
              VALUES (${accountId}, ${conversationId}, ${ticket.id}, 'System', ${systemMsgContent}, 'outgoing')
              RETURNING *
            `;

            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'message.new',
              data: systemMsg
            }));

            const [updatedConv] = await sql`
              SELECT c.*, t.assignee_id, u.name as assignee_name
              FROM conversations c
              LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
              LEFT JOIN users u ON t.assignee_id = u.id
              WHERE c.id = ${conversationId} LIMIT 1
            `;

            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'conversation.updated',
              data: updatedConv
            }));

            dispatchWebhook(accountId, 'conversation.updated', updatedConv).catch(console.error);

            actionsExecuted.push(action);
          } else if (action.type === 'send_reply') {
            if (!conversationId) throw new Error('Conversation ID is missing for send_reply action');
            const replyContent = action.content;

            const [conv] = await sql`
              SELECT ct.phone_number, c.inbox_id, t.id as ticket_id, ch.provider_type
              FROM conversations c
              JOIN contacts ct ON c.contact_id = ct.id
              JOIN inboxes i ON c.inbox_id = i.id
              JOIN channels ch ON i.channel_id = ch.id
              LEFT JOIN tickets t ON t.conversation_id = c.id AND t.status != 'resolved'
              WHERE c.id = ${conversationId} LIMIT 1
            `;

            if (!conv) throw new Error(`Conversation ${conversationId} not found`);

            const [insertedMsg] = await sql`
              INSERT INTO messages (
                account_id, conversation_id, ticket_id, sender_type, 
                content, message_type, status
              ) VALUES (
                ${accountId}, ${conversationId}, ${conv.ticket_id || null}, 'System', 
                ${replyContent || ''}, 'outgoing', 'sent'
              )
              RETURNING *
            `;

            if (conv.provider_type !== 'web_widget') {
              const payload = {
                event: 'message.send',
                data: {
                  inbox_id: Number(conv.inbox_id),
                  internal_message_id: Number(insertedMsg.id),
                  target_id: conv.phone_number,
                  content: replyContent || '',
                  message_type: 'text'
                }
              };
              const targetQueue = `queue:outgoing_messages:inbox_${conv.inbox_id}`;
              await redis.rpush(targetQueue, JSON.stringify({ ...payload, _queued_at: Date.now() }));
            }

            await redis.publish(PUB_SUB_CH, JSON.stringify({
              event: 'message.new',
              data: insertedMsg
            }));

            dispatchWebhook(accountId, 'message.outgoing', insertedMsg).catch(console.error);

            actionsExecuted.push(action);
          }
        } catch (err: any) {
          console.error(`[Automation Engine] Action failed:`, err);
          actionsFailed.push({ ...action, error: err.message });
          executionStatus = 'partial_failure';
        }
      }

      await sql`
        UPDATE automation_rules
        SET 
          execution_count = execution_count + 1,
          last_executed_at = NOW()
        WHERE id = ${rule.id}
      `;

      const executionTime = Date.now() - tStart;
      await sql`
        INSERT INTO automation_logs (
          account_id, rule_id, conversation_id, ticket_id, trigger_type, trigger_data, actions_executed, actions_failed, status, execution_time_ms
        ) VALUES (
          ${accountId}, ${rule.id}, ${conversationId}, ${ticketId}, ${triggerType}, ${sql.json(triggerData)}, ${actionsExecuted.map(a => JSON.stringify(a))}::jsonb[], ${actionsFailed.map(a => JSON.stringify(a))}::jsonb[], ${executionStatus === 'partial_failure' && actionsExecuted.length === 0 ? 'failure' : executionStatus}, ${executionTime}
        )
      `;
    }
  } catch (err) {
    console.error('[Automation Engine] Fatal error executing rules:', err);
  }
}
