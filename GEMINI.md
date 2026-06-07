# Panduan Pengembangan (GEMINI.md)

Dokumen ini berisi panduan, konvensi, dan aturan arsitektur khusus untuk proyek **Omnichannel Customer Support Platform**. Dokumen ini dirancang agar setiap *engineer* atau AI Assistant (termasuk saya, Gemini) yang ikut berkontribusi dapat memahami struktur dan keputusan teknis yang telah diambil.

## 🚨 ATURAN KRITIS (CRITICAL CONSTRAINTS) - WAJIB DIPATUHI
1. **Batasan Runtime (JANGAN DICAMPUR):**
   - `apps/main-api`: WAJIB berjalan di atas **Bun** (Hono).
   - `apps/wa-adapter`: WAJIB berjalan di atas **Node.js** (via `tsx`). JANGAN paksakan `bun` di sini karena pustaka Baileys memiliki masalah kompatibilitas *crypto/net* dengan Bun.
   - `apps/frontend`: React (Vite) + Zustand + TailwindCSS + DaisyUI.
2. **Aturan Database (STRICTLY NO ORM):**
   - **TIDAK BOLEH** menginstal Prisma, TypeORM, Drizzle, atau ORM apa pun.
   - Proyek ini menggunakan `postgres.js` murni. Semua kueri harus menggunakan Raw SQL dengan Tagged Template Literals.
   - Semua *insert/update* krusial harus dibungkus dalam *Transaction* (`await sql.begin(async (tx) => { ... })`).
   - Setiap tabel (kecuali master) WAJIB difilter menggunakan `account_id` untuk menjaga Isolasi Multi-Tenancy. Jangan pernah melakukan `SELECT` tanpa menyertakan `WHERE account_id = ...`.
3. **Komunikasi Antar-Layanan (IPC):**
   - Main API dan WA Adapter **TIDAK** berkomunikasi lewat HTTP REST.
   - Komunikasi harus melalui **Redis Queue** (`lpush`/`brpop`) dan **Redis Pub/Sub** (`publish`/`subscribe`).
   - Semua *payload* JSON yang lewat di Redis WAJIB divalidasi saat *runtime* menggunakan skema `Zod` yang terpusat di `packages/shared-types`.

## 1. Visi & Arsitektur Utama
Platform ini dibangun dengan arsitektur **Microservices** terpisah (*decoupled*) berbasis **Monorepo** (Bun Workspaces) untuk menangani pesan *real-time* dengan konkurensi tinggi.

*   **`apps/main-api`**: Dibangun dengan **Bun + Hono**. Sangat cepat dan fokus pada manipulasi database serta manajemen koneksi WebSocket ke *frontend*.
*   **`apps/wa-adapter`**: Dibangun dengan **Node.js murni + Baileys**. Layanan ini *harus* berjalan di Node.js (bukan Bun).
*   **`apps/frontend`**: Dibangun dengan **React + Vite + DaisyUI** (Tailwind CSS) untuk UI/UX yang modern dan responsif.
*   **Perantara Komunikasi (Message Broker):** Menggunakan **Valkey/Redis**.

## 2. Aturan & Konvensi Database
*   **Wajib Menggunakan Raw SQL:** Di dalam `main-api`, kita menggunakan pustaka `postgres` murni. **JANGAN gunakan ORM** (seperti Prisma atau TypeORM). Keputusan ini diambil secara sadar untuk mencegah *memory bloat* dan menjaga efisiensi saat menangani jutaan baris data pesan.
*   **Multi-tenancy:** Semua tabel data utama (seperti `contacts`, `conversations`, `messages`, `channels`) wajib menyertakan kolom `account_id` untuk memastikan isolasi data antar perusahaan.
*   **Audit Trail & Dual-Write:** Setiap perubahan status percakapan (seperti tutup/buka tiket) harus dicatat ganda (*dual-write*): sebagai data analitik struktural di tabel `conversation_events` dan sebagai gelembung pesan visual di tabel `messages` dengan `sender_type = 'System'`.

## 3. Aturan Koneksi Redis (Anti-Blocking)
Di `apps/main-api`, koneksi Redis dipisahkan menjadi 3 *instance* yang berbeda peruntukannya. Tolong pertahankan pola ini:
1.  **`redis`**: Untuk perintah standar yang non-blokir (seperti `rpush`).
2.  **`redisSub`**: Eksklusif untuk mendengarkan *event* Pub/Sub (`subscribe`).
3.  **`redisWorker`**: Eksklusif untuk mendengarkan antrean masuk dengan metode *blocking* (`brpop`). Hal ini mencegah fungsi API *hang* saat *worker* sedang menunggu pesan.

## 4. Penanganan Data WhatsApp (Baileys)
*   **JID Normalization:** Karena arsitektur *Multi-Device* WhatsApp sering merutekan pesan menggunakan `@lid`, `wa-adapter` telah dikonfigurasi untuk memprioritaskan alamat `@s.whatsapp.net` (dari `remoteJidAlt`) agar riwayat obrolan pelanggan tidak terpecah.
*   **Pesan Sistem:** `wa-adapter` mengabaikan pesan bertipe `protocolMessage` dan kategori `peer` agar pesan internal sinkronisasi kunci WhatsApp tidak masuk sebagai percakapan di *database*.
*   **Group Chat:** Pesan dari grup WhatsApp direkam. Sistem akan menyisipkan tag nama pengirim asli (`participant_name`) di depan isi pesan saat menyimpannya di database (misal: `[Budi]: Halo`).

## 5. Fitur Debugging (Message Dumps)
Jika Anda perlu menambahkan dukungan untuk tipe pesan WhatsApp yang baru (seperti pesan lokasi, reaksi, atau dokumen), **JANGAN langsung menebak strukturnya**.
Lihat data JSON mentah (*raw payload*) yang secara otomatis di-*dump* oleh layanan `wa-adapter` di dalam direktori `apps/wa-adapter/message_dumps/` sebagai referensi struktur data asli dari Baileys.

## 6. Pengembangan Frontend
*   Konfigurasi *Environment Variable* frontend diatur agar dinamis. Semua *URL endpoint* (HTTP & WS) harus mengambil dari `import.meta.env` (bukan *hardcoded*).
*   Gunakan komponen standar dari **DaisyUI** sebanyak mungkin agar UI tetap konsisten dan hemat *bandwidth* CSS.

## Panduan Menjalankan Layanan (Development)
Untuk menjalankan ketiga layanan sekaligus, Anda dapat menggunakan beberapa terminal di *root* proyek:
1. `bun dev:main-api`
2. `bun dev:wa-adapter` (Membutuhkan Node.js)
3. `bun --cwd apps/frontend dev`
Atau gunakan skrip `concurrently` (jika sudah disetup) dengan memanggil `bun dev`.
