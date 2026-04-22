# Kontrak Payload Redis (Inter-Service Communication)

Dokumen ini mendefinisikan struktur data JSON yang digunakan untuk komunikasi antara **Main API (Bun)** dan **WhatsApp Adapter Service (Node.js)** melalui *Redis Queue / Pub-Sub*.

Semua data yang masuk ke antrean Redis harus dibungkus dalam format JSON dengan kunci utama `event` dan `data`.

---

## 1. Dari WA Adapter (Node.js) -> ke Main API (Bun)

### Event: `message.incoming`
Dikirim oleh Baileys saat ada pesan baru masuk dari pelanggan.
*   **Queue Name:** `queue:incoming_messages`

```json
{
  "event": "message.incoming",
  "data": {
    "source_id": "6281234567890@s.whatsapp.net", // ID spesifik WhatsApp (No Pelanggan)
    "push_name": "Budi Santoso",                 // Nama profil WA Pelanggan
    "content": "Halo, saya mau tanya harga",     // Isi pesan teks
    "message_type": "text",                      // Bisa berupa: 'text', 'image', 'document'
    "wa_message_id": "3EB0XXXXXXX",              // ID unik pesan dari sistem WhatsApp
    "timestamp": 1696123456                      // Unix timestamp dari WhatsApp
  }
}
```

### Event: `message.status_update`
Dikirim oleh Baileys saat status pesan yang kita kirim berubah (Misal: dari Terkirim menjadi Dibaca/Centang Biru).
*   **Queue Name:** `queue:incoming_messages` (Bisa menggunakan antrean yang sama)

```json
{
  "event": "message.status_update",
  "data": {
    "wa_message_id": "3EB0XXXXXXX", // ID pesan WA yang sebelumnya dikirim
    "source_id": "6281234567890@s.whatsapp.net",
    "status": "read"                // Enum: 'sent', 'delivered', 'read', 'failed'
  }
}
```

---

## 2. Dari Main API (Bun) -> ke WA Adapter (Node.js)

### Event: `message.send`
Dikirim oleh Main API saat Agen membalas pesan dari Dashboard.
*   **Queue Name:** `queue:outgoing_messages`

```json
{
  "event": "message.send",
  "data": {
    "internal_message_id": 10542,                // ID pesan di tabel `messages` PostgreSQL kita (berguna untuk update status nantinya)
    "target_id": "6281234567890@s.whatsapp.net", // Nomor tujuan
    "content": "Baik Pak Budi, harganya Rp100.000",
    "message_type": "text" 
  }
}
```

### Event: `session.logout` (Opsional/Masa Depan)
Perintah dari Dashboard (Admin) untuk memaksa keluar/memutus koneksi nomor WA.
*   **Queue Name:** `queue:outgoing_messages`

```json
{
  "event": "session.logout",
  "data": {
    "reason": "user_requested"
  }
}
```