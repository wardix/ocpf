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
    *   Bersifat **stateless**. Kredensial autentikasi WhatsApp tidak lagi disimpan dalam folder `auth_info_baileys`, melainkan dikelola langsung di PostgreSQL (`whatsapp_auth_states`) sehingga aman di-deploy dalam kontainer Docker.
    *   Mendengarkan event WhatsApp, memformat payload, dan memasukkannya ke antrean Redis (`queue:incoming_messages`).
    *   Mendengarkan perintah kirim pesan dari Redis (`queue:outgoing_messages`) dan mengirimkannya via Baileys.
    *   Memiliki fitur **Message Dumps** (`apps/wa-adapter/message_dumps/`) yang otomatis menyimpan raw payload JSON dari Baileys untuk keperluan *debugging* atau pengembangan fitur baru (seperti *location*, *reaction*, dll).

4.  **`packages/shared-types`**
    *   Berisi definisi TypeScript interface (`IncomingMessagePayload`, `SendMessagePayload`, dll) yang digunakan bersama oleh `main-api`, `wa-adapter`, dan `frontend` agar struktur data (kontrak komunikasi via Redis) tetap konsisten. Telah dilengkapi runtime validation menggunakan **Zod**.

## Fitur Unggulan (MVP+)
*   **Multi-Tenancy Isolasi Kedap Air:** Setiap rute API dilindungi middleware ketat yang memisahkan data berdasarkan `account_id` pengguna.
*   **Sistem Kategorisasi (Labels/Tags):** Agen dapat menyematkan chip warna-warni ke percakapan, dikelola sepenuhnya oleh administrator.
*   **Visibilitas Tim & Penugasan Paksa (Admin Reassign):** Administrator dapat melihat status agen (Online/Busy/Offline) secara *real-time* via Pub/Sub dan dapat secara paksa mengambil alih atau melempar tiket ke agen lain.
*   **PostgreSQL Full-Text Search (Unified Search):** Pencarian teks super cepat menggunakan GIN Index yang langsung menandai (highlight) kata kunci dalam pesan, dapat dipanggil dengan jalan pintas `Ctrl+K`.
*   **Dukungan Grup WA & Balasan Kutipan (Quote Reply):** Filter khusus untuk memisahkan *chat* grup WhatsApp dengan obrolan pribadi, serta dukungan penuh membalas pesan secara spesifik menggunakan `whatsapp_metadata`.
*   **Ergonomi Tingkat Lanjut:** Dilengkapi dukungan UI/UX penuh seperti Dark Mode (*Theme Switcher*), indikator "Sedang Mengetik" (Typing Indicator), centang biru WhatsApp (*Read Receipts*), hingga *Snoozed Timer* untuk menunda tiket dan menunggunya bangun secara mandiri.
*   **Keyboard Shortcuts Global:** Agen dapat melakukan penugasan, mengirim pesan, atau beralih mode tiket dalam kedipan mata cukup dengan menekan tombol (e.g. `Alt+R`, `Ctrl+Enter`, `Shift+?`).

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
Jalankan script SQL yang ada di file `init.sql` (di dalam root proyek omnichannel-platform) ke dalam database PostgreSQL Anda. File `init.sql` ini adalah representasi terlengkap (*Single Source of Truth*) dari skema arsitektur V3 saat ini.

```bash
# Contoh menggunakan psql CLI:
psql -U username -d nama_database -f init.sql
```

Setelah tabel dibuat, masukkan **Seed Data** awal agar sistem bisa bekerja:
```sql
INSERT INTO accounts (id, name) VALUES (1, 'Akun Utama');
INSERT INTO channels (id, account_id, name, provider_type) VALUES (1, 1, 'WhatsApp Utama', 'whatsapp');
INSERT INTO inboxes (id, account_id, channel_id, name) VALUES (1, 1, 1, 'Inbox WA CS');
```

*Catatan: Skrip migrasi (`apps/main-api/migrate-*.ts`) yang sebelumnya digunakan untuk tambal sulam skema (seperti memisahkan tabel `tickets` dan `conversations`) tidak lagi wajib dijalankan karena seluruh pembaruan telah digabungkan secara utuh ke dalam `init.sql`.*

### 2.1. Evaluasi Framework Migrasi Database (Roadmap)
Mengingat proyek ini telah bertransisi penuh ke arsitektur V3 (multi-tenancy dan pemisahan tiket), metode migrasi "tambal sulam" menggunakan *raw TS script* (`migrate-tickets.ts`, dll) sudah mulai berisiko menimbulkan *Schema Drift* (kondisi di mana struktur basis data di lapangan berbeda dengan dokumen rancangan).

**Rekomendasi Framework:**
Untuk pengembangan tahap selanjutnya (V4), sangat disarankan untuk mengadopsi _Migration Framework_ profesional. Mengingat `main-api` tidak menggunakan ORM (seperti Prisma atau TypeORM) demi efisiensi memori, berikut adalah kandidat utamanya:
1.  **`node-pg-migrate`**: Sangat direkomendasikan karena murni dirancang untuk PostgreSQL, sangat ringan, mendukung penulisan migrasi menggunakan Raw SQL (`pgm.sql()`), dan tidak memaksakan *query builder* berat ke dalam kode.
2.  **`knex.js`**: Populer, tetapi membawa beban pustaka *query builder* yang tidak kita gunakan di aplikasi utama (karena kita menggunakan `postgres.js`).
3.  **`golang-migrate`**: Opsi solid dan independen dari bahasa jika DevOps ingin memisahkan proses *deployment* migrasi dari siklus kode *Node.js/Bun*.

Saat ini, `init.sql` dapat digunakan untuk inisialisasi awal ( *fresh install* ), namun penerapan `node-pg-migrate` harus dijadikan prioritas teknis di masa mendatang.

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