# Omnichannel Customer Support Platform - MVP

Proyek ini adalah prototipe (MVP) dari platform omnichannel customer support (mirip Chatwoot) yang dirancang dengan arsitektur microservices untuk menangani konkurensi tinggi dan komunikasi real-time, menggunakan WhatsApp (via Baileys) sebagai saluran komunikasi pertamanya.

## Arsitektur Proyek (Monorepo)

Proyek ini menggunakan **Bun Workspaces** untuk mengelola beberapa layanan dalam satu repositori:

1.  **`apps/frontend` (React + Vite + DaisyUI)**
    *   Dashboard antarmuka agen (UI 3 Kolom: Sidebar Inbox, Chat Area, Contact Info).
    *   Berkomunikasi dengan Main API via HTTP REST (untuk ambil/kirim pesan) dan WebSocket (untuk pembaruan pesan real-time).
    *   Konfigurasi env ada di `.env` (variabel diawali `VITE_`).

2.  **`apps/main-api` (Bun + Hono + PostgreSQL + Redis)**
    *   Jantung aplikasi yang sangat cepat (*ultrafast*).
    *   Bertugas melayani API HTTP, mengelola WebSocket server, dan berinteraksi dengan database PostgreSQL menggunakan **Raw SQL** (tanpa ORM demi efisiensi memori).
    *   Bertindak sebagai *Consumer* dari antrean pesan masuk (Valkey/Redis) dan *Publisher* untuk antrean pesan keluar.
    *   Menggunakan 3 koneksi Redis terpisah (`redis`, `redisSub`, `redisWorker`) untuk mencegah *blocking* (metode `brpop`) yang dapat membuat API *hang*.

3.  **`apps/wa-adapter` (Node.js + Baileys)**
    *   Layanan adapter mandiri untuk koneksi WhatsApp.
    *   Berjalan di atas **Node.js** (karena library Baileys sangat bergantung pada modul internal Node.js yang lebih stabil dibandingkan Bun untuk kasus ini).
    *   Mendengarkan event WhatsApp, memformat payload, dan memasukkannya ke antrean Redis (`queue:incoming_messages`).
    *   Mendengarkan perintah kirim pesan dari Redis (`queue:outgoing_messages`) dan mengirimkannya via Baileys.
    *   Memiliki fitur **Message Dumps** (`apps/wa-adapter/message_dumps/`) yang otomatis menyimpan raw payload JSON dari Baileys untuk keperluan *debugging* atau pengembangan fitur baru (seperti *location*, *reaction*, dll).

4.  **`packages/shared-types`**
    *   Berisi definisi TypeScript interface (`IncomingMessagePayload`, `SendMessagePayload`, dll) yang digunakan bersama oleh `main-api`, `wa-adapter`, dan `frontend` agar struktur data (kontrak komunikasi via Redis) tetap konsisten.

## Tech Stack Utama
*   **Runtime:** Bun & Node.js (v20+)
*   **Database:** PostgreSQL
*   **Message Broker & Pub/Sub:** Valkey / Redis
*   **Frontend:** React (Vite), TailwindCSS, DaisyUI
*   **Backend Framework:** Hono
*   **WhatsApp Library:** `@whiskeysockets/baileys`

## Panduan Setup & Menjalankan (Untuk Engineer Selanjutnya)

### 1. Persiapan Infrastruktur
Pastikan **PostgreSQL** dan **Valkey/Redis** sudah berjalan di mesin Anda.

### 2. Inisialisasi Database
Jalankan script SQL yang ada di file `init.sql` (di luar folder omnichannel-platform) ke dalam database PostgreSQL Anda.
Setelah tabel dibuat, masukkan **Seed Data** awal agar sistem bisa bekerja:
```sql
INSERT INTO accounts (id, name) VALUES (1, 'Akun Utama');
INSERT INTO channels (id, account_id, name, provider_type) VALUES (1, 1, 'WhatsApp Utama', 'whatsapp');
INSERT INTO inboxes (id, account_id, channel_id, name) VALUES (1, 1, 1, 'Inbox WA CS');
```

### 3. Konfigurasi Environment Variables
Pastikan file `.env` sudah dikonfigurasi dengan benar di masing-masing folder:
*   `apps/main-api/.env` (DATABASE_URL, REDIS_HOST, dll)
*   `apps/wa-adapter/.env` (REDIS_HOST, dll)
*   `apps/frontend/.env` (VITE_API_URL, VITE_WS_URL, VITE_ALLOWED_HOST)

### 4. Instalasi Dependensi
Jalankan perintah ini di root folder proyek:
```bash
bun install
```

### 5. Menjalankan Layanan
Anda perlu menjalankan ketiga layanan ini secara bersamaan di terminal yang berbeda:
```bash
# Terminal 1: Main API
bun run --cwd apps/main-api dev

# Terminal 2: WA Adapter (Akan memunculkan QR Code untuk di-scan)
bun run --cwd apps/wa-adapter dev

# Terminal 3: Frontend Dashboard
bun run --cwd apps/frontend dev
```

## Keputusan Teknis Penting (Technical Decisions Log)
*   **Audit Trail & System Messages:** Saat terjadi perubahan status tiket (tutup/buka kembali), sistem melakukan *dual-write*: mencatat log analitik ke tabel `conversation_events` dan menyisipkan pesan ke ruang obrolan dengan `sender_type = 'System'` agar agen mendapatkan konteks visual secara kronologis.
*   **JID Normalization (Multi-Device):** Di `wa-adapter`, kita memprioritaskan `remoteJidAlt` (`@s.whatsapp.net`) daripada `remoteJid` (`@lid`) untuk pesan dari perangkat pendamping (seperti WA Desktop) agar riwayat obrolan pelanggan tidak terpecah di database.
*   **Group Chat Handling:** `wa-adapter` sudah dimodifikasi untuk mendeteksi pesan grup (`@g.us`). Sistem akan mengambil nama grup via `groupMetadata` dan menangkap nomor pengirim asli (participant) agar `main-api` bisa memberikan *prefix* nama pada pesan grup.
*   **Redis Connection Splitting:** Di `main-api`, koneksi Redis dipisah menjadi 3 bagian (`redis` biasa, `redisSub` untuk websocket, dan `redisWorker` khusus untuk `brpop`). Ini adalah solusi wajib untuk mencegah fungsi antrean (blocking pop) membekukan (*hang*) seluruh server Hono saat agen mencoba membalas pesan.

## Catatan untuk Gemini CLI / AI Assistant Berikutnya
*   Proyek ini menggunakan **Raw SQL** (`postgres.js`) di `main-api`. Jangan gunakan ORM seperti Prisma/TypeORM untuk mencegah *memory bloat* saat menangani jutaan pesan.
*   Jika ingin menambahkan dukungan format pesan baru (misal: Gambar/Audio), periksa terlebih dahulu contoh struktur payload mentahnya di dalam folder `apps/wa-adapter/message_dumps/` sebelum mengubah parser di `wa-adapter`.
*   Sistem saat ini di-*hardcode* untuk beroperasi pada `account_id = 1` dan `inbox_id = 1`. Untuk pengembangan selanjutnya, logika *routing* inbox perlu diimplementasikan berdasarkan `channel_id`.