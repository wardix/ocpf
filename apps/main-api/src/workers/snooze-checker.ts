import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';

export function startSnoozeChecker() {
  console.log('[Snooze Checker] ⏰ Worker dimulai (interval: 60s)');

  setInterval(async () => {
    if ((globalThis as any).isShuttingDown) return;
    try {
      // Cari tiket snoozed yang sudah expired
      const expiredTickets = await sql`
        UPDATE tickets
        SET status = 'open', snoozed_until = NULL, updated_at = NOW()
        WHERE status = 'snoozed'
          AND snoozed_until IS NOT NULL
          AND snoozed_until <= NOW()
        RETURNING *
      `;

      for (const ticket of expiredTickets) {
        console.log(`[Snooze Checker] Re-opening ticket #${ticket.id} (conversation ${ticket.conversation_id})`);

        // Dual-write: event + system message
        await sql`
          INSERT INTO conversation_events (account_id, conversation_id, ticket_id, actor_type, actor_id, event_type, event_data)
          VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'System', NULL, 'unsnoozed', ${sql.json({ auto: true })})
        `;

        const [sysMsg] = await sql`
          INSERT INTO messages (account_id, conversation_id, ticket_id, sender_type, sender_id, content, message_type, status)
          VALUES (${ticket.account_id}, ${ticket.conversation_id}, ${ticket.id}, 'System', NULL,
            'Tiket dibuka kembali secara otomatis (snooze berakhir)',
            'template', 'sent')
          RETURNING *
        `;

        await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: sysMsg }));
        
        // Broadcast conversation status change trigger if needed
        await redis.publish(PUB_SUB_CH, JSON.stringify({ 
          event: 'conversation.updated', 
          data: { 
            id: ticket.conversation_id, 
            account_id: ticket.account_id,
            status: 'open',
            snoozed_until: null
          } 
        }));

        // Create Notification
        if (ticket.assignee_id) {
          const { createNotification } = await import('../utils/notifications');
          await createNotification({
            userId: ticket.assignee_id,
            accountId: ticket.account_id,
            type: 'snoozed_ticket_due',
            title: 'Snooze Berakhir',
            body: `Waktu tunggu tiket #${ticket.id} telah berakhir.`,
            data: { conversation_id: ticket.conversation_id, ticket_id: ticket.id }
          });
        }
      }

      if (expiredTickets.length > 0) {
        console.log(`[Snooze Checker] ${expiredTickets.length} tiket di-reopen`);
      }
    } catch (error) {
      console.error('[Snooze Checker] Error:', error);
    }
  }, 60_000); // Setiap 60 detik
}