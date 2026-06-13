# Kontrak Payload Redis (Inter-Service Communication)

Dokumen ini mendefinisikan struktur data JSON yang digunakan untuk komunikasi antara **Main API (Bun)** dan **WhatsApp Adapter Service (Node.js)** melalui *Redis Queue / Pub-Sub*.

Semua data yang masuk ke antrean Redis harus dibungkus dalam format JSON dengan kunci utama `event` dan `data`. Paket npm `@omnichannel/shared-types` mengikat struktur ini secara *type-safe*.

---

## 1. Dari WA Adapter -> ke Main API (Incoming)

### Event: `message.incoming`
Dikirim oleh Baileys saat ada pesan baru masuk dari pelanggan atau sinkronisasi gema host (*host echo*).
*   **Queue Name:** `queue:incoming_messages`

```json
{
  "event": "message.incoming",
  "data": {
    "inbox_id": 1,                               // Wajib: Menandakan dari inbox/channel mana pesan ini berasal
    "source_id": "6281234567890",                // ID unik sumber
    "source_jid": "6281234567890@s.whatsapp.net",// JID asli dari Baileys
    "push_name": "Budi Santoso",                 // Nama pengguna/grup
    "content": "Halo, saya mau tanya harga",
    "message_type": "text",                      // Enum: text, image, document, audio, video, sticker, location, contact, reaction, poll, unknown
    "wa_message_id": "3EB0XXXXXXX",
    "timestamp": 1696123456,
    "participant_id": null,                      // Terisi jika pesan ini dari dalam Grup WA
    "participant_name": null,
    "is_host_echo": false,                       // True jika dikirim secara manual dari HP admin
    "whatsapp_metadata": {                       // Opsional: Data spesifik WA (seperti quoted message)
      "quoted_wa_id": "3EB0YYYYYYY",
      "quoted_participant": "6281234567890@s.whatsapp.net"
    },
    "media": {                                   // Opsional, hanya jika ada lampiran
      "mimetype": "image/jpeg",
      "data_base64": "/9j/4AAQSkZJRg...",
      "filename": "foto_produk.jpg"
    }
  }
}
```

### Event: `message.status_update`
Dikirim oleh Baileys saat status pesan berubah (misal: dikirim, dibaca).
*   **Queue Name:** `queue:incoming_messages`

```json
{
  "event": "message.status_update",
  "data": {
    "inbox_id": 1,
    "wa_message_id": "3EB0XXXXXXX",
    "source_id": "6281234567890@s.whatsapp.net",
    "status": "read",               // Enum: 'sent', 'delivered', 'read', 'failed'
    "timestamp": 1696123500         // Waktu indikator status dikirim
  }
}
```

### Event: `typing.update`
Dikirim oleh WA Adapter saat ada pergerakan indikator mengetik (composing/paused) dari pelanggan.
*   **Pub/Sub Channel:** `chat:events`

```json
{
  "event": "typing.update",
  "data": {
    "inbox_id": 1,
    "jid": "6281234567890@s.whatsapp.net",
    "is_typing": true
  }
}
```

---

## 2. Dari Main API -> ke WA Adapter (Outgoing)

### Event: `message.send`
Dikirim oleh Main API ke antrean spesifik inbox.
*   **Queue Name Dinamis:** `queue:outgoing_messages:inbox_{INBOX_ID}`

```json
{
  "event": "message.send",
  "data": {
    "inbox_id": 1,
    "internal_message_id": 10542,                // ID pesan di tabel `messages`
    "target_id": "6281234567890@s.whatsapp.net", // JID tujuan
    "content": "Baik Pak Budi, harganya Rp100.000",
    "message_type": "text",
    "is_private": false,                         // Abaikan dari pengiriman jika ini sekadar private note antar agen
    "reply_to_message_id": 10541,                // Opsional: ID internal pesan yang di-quote
    "media": {                                   // Opsional
      "mimetype": "application/pdf",
      "data_base64": "JVBERi0xLjQK...",
      "filename": "invoice.pdf"
    }
  }
}
```

### Event: `typing.send`
Dikirim oleh Main API untuk memberi sinyal 'sedang mengetik' ke WhatsApp pelanggan.
*   **Queue Name Dinamis:** `queue:outgoing_messages:inbox_{INBOX_ID}`

```json
{
  "event": "typing.send",
  "data": {
    "inbox_id": 1,
    "jid": "6281234567890@s.whatsapp.net"
  }
}
```