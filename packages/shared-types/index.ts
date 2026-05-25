// packages/shared-types/index.ts

export type MessageType = 'text' | 'image' | 'document';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

// Payload dari WA Adapter -> Main API (Incoming Message)
export interface IncomingMessagePayload {
  event: 'message.incoming';
  data: {
    inbox_id: number;         // ID Kotak Masuk (untuk Multi-Instance)
    source_id: string;        // ID WhatsApp (nomor atau angka unik grup)
    source_jid: string;       // Alamat lengkap (misal: 12345@g.us, 62812@s.whatsapp.net)
    push_name: string;        // Nama kontak atau nama grup
    content: string;
    message_type: MessageType;
    wa_message_id: string;
    timestamp: number;
    participant_id?: string;
    participant_name?: string;
    is_host_echo?: boolean; // True jika pesan dikirim manual dari HP Host
    media?: {
      mimetype: string;
      data_base64: string;
      filename?: string;
    };
  };
}

// Payload dari WA Adapter -> Main API (Status Update)
export interface MessageStatusUpdatePayload {
  event: 'message.status_update';
  data: {
    inbox_id: number;
    wa_message_id: string;
    source_id: string;
    status: MessageStatus;
  };
}

// Payload dari Main API -> WA Adapter (Send Message)
export interface SendMessagePayload {
  event: 'message.send';
  data: {
    inbox_id: number;
    internal_message_id: number;
    target_id: string;
    content: string;
    message_type: MessageType;
    media?: {
      mimetype: string;
      data_base64: string;
      filename?: string;
    };
  };
}

// Union Type untuk semua payload Redis
export type RedisQueuePayload = 
  | IncomingMessagePayload 
  | MessageStatusUpdatePayload 
  | SendMessagePayload;