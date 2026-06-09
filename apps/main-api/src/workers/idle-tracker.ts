import { sql } from '../config/database';
import { evaluateAutomationRules } from '../utils/automation';

export function startIdleTracker() {
  console.log('[Idle Tracker] ⏰ Worker dimulai (interval: 60s)');

  setInterval(async () => {
    if ((globalThis as any).isShuttingDown) return;
    try {
      // 1. Fetch all active rules with trigger_type = 'ticket.idle'
      const idleRules = await sql`
        SELECT * FROM automation_rules
        WHERE trigger_type = 'ticket.idle' AND is_active = true
      `;

      if (idleRules.length === 0) return;

      for (const rule of idleRules) {
        const config = rule.trigger_config || {};
        const idleMinutes = Number(config.idle_minutes || 30);
        const accountId = Number(rule.account_id);

        // 2. Find active tickets for this account
        const activeTickets = await sql`
          SELECT id, conversation_id, status, created_at, updated_at
          FROM tickets
          WHERE account_id = ${accountId} AND status IN ('open', 'pending')
        `;

        for (const ticket of activeTickets) {
          // 3. Find last message timestamp for this ticket
          const [lastMsg] = await sql`
            SELECT MAX(created_at) as last_msg_at FROM messages
            WHERE ticket_id = ${ticket.id} OR conversation_id = ${ticket.conversation_id}
          `;

          const lastActivityTime = lastMsg?.last_msg_at 
            ? new Date(lastMsg.last_msg_at) 
            : new Date(ticket.updated_at || ticket.created_at);

          const minutesIdle = (Date.now() - lastActivityTime.getTime()) / (60 * 1000);

          if (minutesIdle >= idleMinutes) {
            // 4. Check if we already executed this rule on this ticket since the last activity
            const [alreadyExecuted] = await sql`
              SELECT id FROM automation_logs
              WHERE rule_id = ${rule.id}
                AND ticket_id = ${ticket.id}
                AND created_at >= ${lastActivityTime}
              LIMIT 1
            `;

            if (!alreadyExecuted) {
              console.log(`[Idle Tracker] Ticket #${ticket.id} is idle for ${Math.round(minutesIdle)}m. Running rule: "${rule.name}"`);
              
              // Trigger rule execution
              await evaluateAutomationRules(accountId, 'ticket.idle', {
                conversation_id: Number(ticket.conversation_id),
                ticket_id: Number(ticket.id),
                status: ticket.status
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[Idle Tracker] Error:', err);
    }
  }, 60_000);
}
