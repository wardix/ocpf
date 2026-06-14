# OmniDesk — Omnichannel Customer Support Platform

Platform customer support omnichannel (terinspirasi Chatwoot) yang dibangun dengan arsitektur **microservices** di dalam **monorepo** (Bun Workspaces). Dirancang untuk menangani pesan real-time dengan konkurensi tinggi, multi-tenancy kedap air, dan dukungan multi-channel (WhatsApp, Email, Telegram, Web Widget).

---

## Daftar Isi

- [Arsitektur](#arsitektur)
- [Tech Stack](#tech-stack)
- [Fitur](#fitur)
- [Struktur Monorepo](#struktur-monorepo)
- [Database](#database)
- [Komunikasi Antar-Layanan](#komunikasi-antar-layanan)
- [Background Workers](#background-workers)
- [Panduan Setup](#panduan-setup)
- [Menjalankan Layanan](#menjalankan-layanan)
- [Docker](#docker)
- [Monitoring & Observability](#monitoring--observability)
- [Testing](#testing)
- [Backup & Recovery](#backup--recovery)
- [Keputusan Teknis](#keputusan-teknis)
- [Catatan untuk Kontributor](#catatan-untuk-kontributor)

---

## Arsitektur

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend    │◄────┤  Nginx       │────►│  Main API       │
│  React+Vite  │ WS  │  (Reverse    │ API │  Bun + Hono     │
│  DaisyUI     │◄────┤   Proxy)     │────►│  PostgreSQL     │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          Redis Queue & Pub/Sub
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
             ┌──────┴───────┐            ┌─────────┴────────┐          ┌──────────┴─────────┐
             │ WA Adapter   │            │ Email Adapter    │          │ Telegram Adapter   │
             │ Node.js      │            │ Node.js          │          │ Bun                │
             │ Baileys      │            │ ImapFlow + SMTP  │          │ grammY             │
             └──────────────┘            └──────────────────┘          └────────────────────┘

             ┌──────────────┐
             │ Web Widget   │  ← Embed di situs pelanggan (Preact, Shadow DOM)
             │ Single JS    │
             └──────────────┘
```

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| **Runtime** | Bun (main-api, telegram-adapter), Node.js v20+ (wa-adapter, email-adapter) |
| **Backend Framework** | Hono (+ Swagger UI, Zod Validator) |
| **Database** | PostgreSQL 15 — Raw SQL via `postgres.js` (tanpa ORM) |
| **Migration** | `node-pg-migrate` |
| **Message Broker** | Valkey / Redis 7 — Queue (`lpush`/`brpop`) + Pub/Sub |
| **Frontend** | React 18, Vite 5, Zustand 5, TailwindCSS 3, DaisyUI 4 |
| **Widget** | Preact (~3KB), Shadow DOM, Vite (IIFE build) |
| **WhatsApp** | `@whiskeysockets/baileys` |
| **Email** | ImapFlow (IMAP IDLE) + Nodemailer (SMTP) |
| **Telegram** | `grammY` |
| **Charting** | Recharts |
| **Chatbot Builder** | ReactFlow |
| **Virtualized Lists** | @tanstack/react-virtual |
| **Internasionalisasi** | i18next (ID & EN) |
| **Auth** | JWT (HS256) + bcrypt, API Key (SHA-256 hash) |
| **Validasi Runtime** | Zod (shared-types) |
| **Monitoring** | Sentry, Pino (structured logging), Prometheus + Grafana |
| **Testing** | Bun Test (main-api), Vitest (frontend), Node Test Runner (wa-adapter) |
| **Container** | Docker + Docker Compose |
| **Reverse Proxy** | Nginx (SSL termination, auto self-signed cert) |

---

## Fitur

### Manajemen Percakapan
- **UI 3 Kolom**: Sidebar Inbox, Chat Area, Contact Info Panel
- **Multi-channel**: WhatsApp, Email, Telegram, Web Widget dalam satu dashboard
- **Ticket Lifecycle**: Status `open` → `pending` → `snoozed` → `resolved` dengan audit trail
- **Pemisahan Conversation & Ticket**: Conversation = wadah abadi histori, Ticket = siklus hidup issue spesifik
- **Quote Reply**: Membalas pesan spesifik dengan referensi kutipan (WhatsApp `contextInfo`)
- **Private Notes**: Catatan internal antar-agen (tidak terlihat pelanggan)
- **Typing Indicator**: Real-time bi-directional — agen dan pelanggan
- **Read Receipts**: Centang biru WhatsApp (sent → delivered → read) via Baileys status update
- **Snooze Timer**: Tunda tiket dan otomatis bangun sesuai jadwal (dicek setiap 60 detik)
- **Bulk Actions**: Aksi massal (assign, resolve, reopen) untuk banyak tiket sekaligus
- **Collision Detection**: Melihat agen lain yang sedang melihat percakapan yang sama (Redis sorted set + heartbeat 10 detik)
- **Scheduled Messages**: Jadwalkan pengiriman pesan di waktu tertentu

### Rich Media
- **Gambar, Video, Audio, Dokumen, Sticker**: Upload + download media otomatis
- **Lokasi**: Render sebagai Google Maps link
- **Kontak (vCard)**: Ekstraksi nomor telepon
- **ViewOnce Messages**: Unwrap pesan sekali lihat WhatsApp
- **Email HTML**: Render konten HTML email dengan metadata (subject, CC, BCC, threading)

### Multi-tenancy & Keamanan
- **Isolasi Data Kedap Air**: Setiap query difilter `account_id`
- **Role-Based Access**: Administrator (akses penuh) & Agent (permission terbatas)
- **Permission System**: Granular permission per resource (contacts.read, messages.write, dll)
- **API Key Authentication**: Akses programatik via `X-API-Key` header dengan permission kustom
- **JWT Auth**: Token-based authentication untuk dashboard
- **Rate Limiting**: 100 request/menit per IP (Redis-based sliding window, fail-open)
- **Secure Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Path Traversal Prevention**: Validasi path upload/export

### Agen & Tim
- **Team Management**: Buat tim, assign member, tentukan leader
- **Auto-Assignment**: Round Robin atau Least Busy per inbox (konfigurabel)
- **Admin Reassign**: Administrator dapat memaksa transfer tiket ke agen lain
- **Agent Status**: Online / Busy / Offline real-time via Pub/Sub (auto-offline saat `beforeunload`)
- **Idle Tracker**: Notifikasi otomatis untuk tiket yang tidak direspons > 30 menit

### Kontak
- **Contact Management**: CRUD dengan custom attributes (JSONB)
- **Merge Contacts**: Gabungkan duplikat kontak dengan log audit lengkap
- **Soft Delete**: Hapus kontak tanpa kehilangan histori

### Pencarian & Navigasi
- **Full-Text Search** (Ctrl+K): PostgreSQL `ts_headline` GIN Index dengan highlight kata kunci
- **Unified Search**: Cari pesan dan kontak sekaligus (SearchPalette multi-tab)
- **Keyboard Shortcuts**: `?` (panduan), `Ctrl+K` (search), `Escape` (tutup modal)
- **Deep Linking**: URL params `?phone=` dan `?ticket=` untuk auto-open percakapan
- **Mobile Gestures**: Swipe-back untuk navigasi mobile

### Chatbot
- **Visual Flow Builder**: Drag-and-drop editor menggunakan ReactFlow dengan preview
- **Node Types**: Welcome, Menu, Collect Input, Condition, API Call, Assign Agent, Send Message, End
- **Variable Substitution**: `{{user_input}}`, `{{contact_name}}`, `{{phone_number}}`, `{{api_hasil.field}}`
- **Global Commands**: Keyword trigger (e.g. `!menu`, `!bantuan`), wildcard `*` routing
- **Version Control**: Simpan dan rollback versi konfigurasi bot
- **LLM Integration Pattern**: Routing ke external LLM via API Call node

### Otomasi & Integrasi
- **Automation Rules Engine**: Trigger (`message.incoming`, `ticket.idle`, `status.changed`, `contact.created`) → Condition (contains/exact/regex) → Action (assign, label, reply, change_status)
- **Webhooks**: CRUD dengan HMAC-SHA256 signature, retry 3x (exponential backoff), delivery log lengkap
- **AI Integration**: Smart Reply, Summarize, Auto-Categorize — mendukung OpenAI dan Gemini, dengan rate limit 50 call/jam/account
- **Broadcast**: Kirim pesan massal ke banyak kontak dengan template
- **CSAT Survey**: Survei kepuasan otomatis setelah tiket resolved (rating 1-5, delay konfigurabel)

### Pelaporan & Analitik
- **Dashboard Analytics**: Volume percakapan (AreaChart), response time, agent performance table, resolusi
- **Export Data**: Export ke CSV / XLSX via background worker dengan progress tracking
- **AI Usage Logs**: Tracking token input/output dan latency per fitur AI

### Inbox Configuration
- **Business Hours**: Jadwal per hari (Senin-Minggu) per inbox, timezone-aware (`Asia/Jakarta` default)
- **Out-of-Office Message**: Pesan otomatis di luar jam operasional
- **CSAT Settings**: Enable/disable per inbox, delay konfigurabel, pesan kustom
- **Auto-Assignment Settings**: Algoritma (round_robin/least_busy), max tickets per agen
- **Greeting Message**: Pesan sambutan untuk percakapan baru

### UI/UX
- **Dark Mode**: Theme switcher (Light/Dark/Corporate via DaisyUI)
- **PWA Support**: Service Worker, manifest.json, theme-color — installable di mobile
- **Responsive Design**: Desktop 3-kolom, mobile bottom navigation
- **Flash-free Theme**: Inline script menerapkan tema sebelum React hydrate
- **Internasionalisasi**: Bahasa Indonesia & English (auto-detect via browser)
- **Canned Responses**: Balas cepat dengan shortcode (trigger `/`)
- **Message Templates**: Template pesan dengan variabel dinamis
- **Notification Bell**: Real-time notification dengan unread count (browser Notification API)
- **Notification Sound**: Web Audio API (sine wave oscillator)
- **Labels/Tags**: Chip berwarna untuk kategorisasi percakapan (dengan AI-recommended labels)
- **Virtual Scrolling**: Performa optimal untuk riwayat chat panjang

### Web Widget (Embeddable)
- **Single Script**: Satu file `widget.js` (IIFE build) untuk embed di situs pelanggan
- **Shadow DOM**: Isolasi CSS lengkap dari halaman host
- **Pre-chat Form**: Kumpulkan nama & email sebelum chat
- **Session Management**: Browser fingerprint (MurmurHash3) + dual storage (localStorage + cookie)
- **Real-time**: WebSocket untuk pesan instan
- **Customizable**: Warna tema, posisi (kiri/kanan), nama & deskripsi
- **Typing Indicators**: Bi-directional antara pengunjung dan agen

```html
<!-- Cara embed -->
<script src="https://your-domain/widget.js" data-inbox-id="1" data-api-url="https://api.example.com"></script>
```

---

## Struktur Monorepo

```
omnichannel-platform/
├── apps/
│   ├── main-api/              # Backend utama (Bun + Hono)
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point: server, WS, Redis, routes, workers
│   │   │   ├── routes/                # 24 route modules (REST API)
│   │   │   ├── workers/               # 7 background workers
│   │   │   ├── middleware/            # auth.ts (JWT + API Key), rate-limiter.ts
│   │   │   ├── websocket/            # WS handler (heartbeat, typing, collision detection)
│   │   │   ├── chatbot/              # FSM chatbot engine
│   │   │   ├── config/               # database.ts, redis.ts (4 instances), business-hours.ts
│   │   │   ├── utils/                # monitoring, ai, crypto, search, webhooks, automation, notifications
│   │   │   └── types/                # Hono type extensions
│   │   ├── migrations/               # node-pg-migrate SQL migrations (4 files)
│   │   ├── test/                     # 23 test files
│   │   ├── public/                   # widget.js (built), uploads/
│   │   ├── seed-user.ts              # Seed administrator
│   │   └── seed-agent.ts             # Seed agent
│   │
│   ├── wa-adapter/                # WhatsApp adapter (Node.js + Baileys)
│   │   └── src/
│   │       ├── index.ts                   # Multi-session WA, media handling, message dumps
│   │       ├── postgres-auth-state.ts     # Stateless auth (credentials di PostgreSQL)
│   │       └── database.ts
│   │
│   ├── email-adapter/             # Email adapter (Node.js + ImapFlow/Nodemailer)
│   │   └── src/
│   │       └── index.ts                   # IMAP IDLE listener + SMTP sender, threading
│   │
│   ├── telegram-adapter/          # Telegram adapter (Bun + grammY)
│   │   └── index.ts                       # Dynamic channel sync dari DB, multi-bot
│   │
│   ├── frontend/                  # Dashboard agen (React + Vite + DaisyUI)
│   │   └── src/
│   │       ├── App.tsx                    # Root app, routing, WS, shortcuts, error boundary
│   │       ├── components/                # 27 komponen UI
│   │       ├── store/                     # 6 Zustand stores
│   │       ├── hooks/                     # 3 custom hooks
│   │       ├── locales/                   # i18n (id.json, en.json)
│   │       └── i18n.ts
│   │
│   └── widget/                    # Embeddable chat widget (Preact + Shadow DOM)
│       └── src/
│           ├── index.tsx                  # Bootstrap, fingerprint, session, Shadow DOM
│           ├── Widget.tsx                 # Chat UI component
│           └── styles.css                 # Scoped widget styles
│
├── packages/
│   └── shared-types/              # Kontrak data bersama (Zod schemas)
│       ├── index.ts                       # 6 schemas, discriminated union
│       └── schemas.test.ts
│
├── init.sql                       # Database schema (legacy, gunakan migrations)
├── docker-compose.yml             # Development (10 services)
├── docker-compose.prod.yml        # Production overrides
├── nginx/                         # Reverse proxy + SSL (auto self-signed cert)
├── monitoring/                    # Prometheus config + Grafana dashboards
├── scripts/                       # Backup script
└── package.json                   # Bun workspaces root
```

---

## Database

### Prinsip
- **Raw SQL only** — menggunakan `postgres.js` dengan Tagged Template Literals. **Tidak ada ORM** (Prisma, TypeORM, Drizzle) demi efisiensi memori saat menangani jutaan pesan.
- **Multi-tenancy** — setiap tabel data (kecuali `users`) memiliki kolom `account_id` sebagai filter wajib.
- **Full-Text Search** — PostgreSQL native FTS dengan GIN Index pada `messages.search_vector` dan `contacts.search_vector` (generated columns).
- **Migrasi** — menggunakan `node-pg-migrate` untuk versioned schema changes.

### Schema

| Kategori | Tabel |
|---|---|
| **Core & Users** | `accounts`, `users`, `account_users`, `teams`, `team_members` |
| **Routing** | `channels`, `inboxes`, `inbox_settings`, `inbox_members`, `business_hours` |
| **Kontak** | `contacts`, `contact_inboxes`, `contact_merge_logs` |
| **Percakapan** | `conversations`, `tickets`, `messages`, `attachments`, `conversation_events` |
| **Canned Responses** | `canned_responses` |
| **Labels** | `labels`, `conversation_labels`, `label_team_routing` |
| **CSAT** | `csat_ratings` |
| **Widget** | `widget_sessions` |
| **Chatbot** | `chatbot_configs`, `chatbot_config_versions` |
| **Webhooks** | `webhooks`, `webhook_delivery_logs` |
| **AI** | `ai_configs`, `ai_usage_logs` |
| **Automation** | `automation_rules`, `automation_logs` |
| **Pesan Terjadwal** | `scheduled_messages` |
| **Email** | `email_message_metadata` |
| **Templates** | `message_templates` |
| **Export** | `export_jobs` |
| **API Keys** | `api_keys` |
| **Notifikasi** | `notifications` |
| **Auth WA** | `whatsapp_auth_states` |

### Migrations (node-pg-migrate)

| File | Deskripsi |
|---|---|
| `1718000000000_initial-schema.ts` | Initial schema (30+ tabel, enum types, 40+ indexes) |
| `1718100000000_add-reply-to-message-id.ts` | Tambah `reply_to_message_id` ke `messages` |
| `1718200000000_create-whatsapp-auth-states.ts` | Tabel auth state WA (stateless sessions) |
| `1718300000000_add-fts-search-vectors.ts` | Generated columns + GIN index untuk FTS |

---

## Komunikasi Antar-Layanan

Layanan **tidak** berkomunikasi via HTTP REST. Semua IPC menggunakan **Redis Queue** dan **Pub/Sub**.

### Redis Queues

| Queue | Arah | Fungsi |
|---|---|---|
| `queue:incoming_messages` | Adapter → Main API | Pesan masuk + status update dari semua channel |
| `queue:outgoing_messages:inbox_{id}` | Main API → Adapter | Perintah kirim pesan (per-inbox routing) |
| `queue:webhook_deliveries` | Internal | Dispatch webhook ke endpoint external |
| `queue:export_jobs` | Internal | Proses export data |

### Redis Pub/Sub Channels

| Channel | Fungsi |
|---|---|
| `chat:events` | Broadcast event real-time (typing, status, message) ke WebSocket clients |
| `system:telegram:refresh_channels` | Trigger re-sync channel Telegram |

### Koneksi Redis di Main API (4 instance terpisah)
1. **`redis`** — Perintah standar non-blokir (`rpush`, `publish`, `incr`, dll)
2. **`redisSub`** — Eksklusif untuk mendengarkan Pub/Sub (`subscribe`)
3. **`redisWorker`** — Eksklusif untuk blocking pop (`brpop`) incoming messages
4. **`redisWebhookWorker`** — Eksklusif untuk blocking pop webhook deliveries

### Validasi Payload
Semua payload JSON yang melewati Redis divalidasi saat runtime menggunakan **Zod schemas** dari `packages/shared-types`:

| Schema | Event | Fungsi |
|---|---|---|
| `IncomingMessagePayloadSchema` | `message.incoming` | Pesan masuk dari channel |
| `MessageStatusUpdatePayloadSchema` | `message.status_update` | Delivery/read receipts |
| `SendMessagePayloadSchema` | `message.send` | Perintah kirim pesan keluar |
| `TypingUpdatePayloadSchema` | `typing.update` | Status typing dari pelanggan |
| `SendTypingPayloadSchema` | `typing.send` | Perintah kirim typing ke channel |
| `RedisQueuePayloadSchema` | *(discriminated union)* | Validasi semua event sekaligus |

---

## Background Workers

Main API menjalankan 7 background worker saat boot:

| Worker | Mekanisme | Fungsi |
|---|---|---|
| **incoming-message** | `brpop` (real-time) | Proses pesan masuk: upsert contact, upsert conversation, buat/reuse ticket, simpan pesan, handle media, trigger chatbot, broadcast via Pub/Sub → WS, trigger automation rules, dispatch webhook |
| **webhook-worker** | `brpop` (real-time) | Dispatch webhook: HMAC-SHA256 signature, retry 3x (exponential backoff), log delivery |
| **export-worker** | `brpop` (real-time) | Proses export ke CSV (csv-stringify) / XLSX (exceljs) dengan progress tracking |
| **csat-worker** | Poll 60 detik | Kirim survei CSAT ke pelanggan setelah tiket di-resolve (dengan delay konfigurabel per inbox) |
| **snooze-checker** | Poll 60 detik | Bangunkan tiket snoozed yang sudah jatuh tempo, insert system message, kirim notifikasi |
| **scheduled-messages** | Poll 30 detik | Kirim pesan terjadwal yang sudah waktunya |
| **idle-tracker** | Poll 5 menit | Trigger automation rule `ticket.idle` untuk tiket open yang tidak direspons > 30 menit |

---

## Panduan Setup

### 1. Prasyarat
- **Bun** (versi terbaru)
- **Node.js** v20+ (untuk wa-adapter dan email-adapter)
- **PostgreSQL** 15+
- **Valkey / Redis** 7+

### 2. Instalasi Dependensi
```bash
bun install
```

### 3. Inisialisasi Database

Buat database lalu jalankan migration:
```bash
createdb omnichannel

# Jalankan semua migrations
bun run --cwd apps/main-api migrate:up
```

Kemudian masukkan seed data awal:
```sql
INSERT INTO accounts (id, name) VALUES (1, 'Akun Utama');
INSERT INTO channels (id, account_id, name, provider_type) VALUES (1, 1, 'WhatsApp Utama', 'whatsapp');
INSERT INTO inboxes (id, account_id, channel_id, name) VALUES (1, 1, 1, 'Inbox WA CS');
```

### 4. Buat User Pertama
```bash
# Buat administrator (admin@omnichannel.local / password123)
bun run --cwd apps/main-api seed:user

# Buat agent (agent@omnichannel.local / password123)
bun run --cwd apps/main-api seed:agent
```

### 5. Konfigurasi Environment Variables

**`apps/main-api/.env`**
```env
DATABASE_URL=postgres://user:password@localhost:5432/omnichannel
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
PORT=8000
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173
JWT_SECRET=your-super-secret-jwt-key    # WAJIB — app crash jika kosong
SENTRY_DSN=                             # Opsional — error tracking
LOG_LEVEL=info                          # Opsional — pino log level
```

**`apps/wa-adapter/.env`**
```env
DATABASE_URL=postgres://user:password@localhost:5432/omnichannel
REDIS_HOST=localhost
REDIS_PORT=6379
INBOX_ID=1
SESSION_DIR=auth_info_baileys
ENABLE_MESSAGE_DUMPS=false
```

**`apps/frontend/.env`**
```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
VITE_ALLOWED_HOST=localhost
```

**`apps/email-adapter/.env`**
```env
REDIS_HOST=localhost
REDIS_PORT=6379
EMAIL_INBOXES=[{"id":2,"imap_host":"imap.example.com","imap_port":993,"imap_secure":true,"smtp_host":"smtp.example.com","smtp_port":587,"smtp_secure":false,"user":"support@example.com","pass":"password"}]
```

**`apps/telegram-adapter/.env`**
*(Konfigurasi channel disimpan di database via `channels.provider_config.token`)*
```env
DATABASE_URL=postgres://user:password@localhost:5432/omnichannel
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## Menjalankan Layanan

Buka terminal terpisah untuk setiap layanan:

```bash
# Terminal 1: Main API (Bun, port 8000)
bun dev:main-api

# Terminal 2: WA Adapter (Node.js — akan menampilkan QR Code untuk di-scan)
bun dev:wa-adapter

# Terminal 3: Frontend (Vite, port 5173)
bun --cwd apps/frontend dev

# Terminal 4 (Opsional): Email Adapter (Node.js, port 8082)
bun dev:email-adapter

# Terminal 5 (Opsional): Telegram Adapter (Bun, port 8081)
bun dev:telegram-adapter
```

Akses dashboard di: **http://localhost:5173**

---

## Docker

### Development
```bash
docker compose up -d
```

Menjalankan 10 services: PostgreSQL (5432), Redis (6379), Main API (8000), WA Adapter, Email Adapter, Telegram Adapter, Frontend (5173→80), Nginx Gateway (80, 443), Prometheus (9090), Grafana (3000).

### Production
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Perbedaan production:
- Semua port internal disembunyikan di belakang Nginx gateway
- `restart: always` pada semua services
- SSL termination (auto self-signed cert jika tidak ada cert manual)
- Environment variables dari shell/CI (bukan `.env` file)
- Frontend build args menggunakan production URLs

### Nginx Gateway

Konfigurasi di `nginx/`:
- **HTTP → HTTPS redirect** (port 80 → 443)
- **SSL**: TLSv1.2/1.3, strong ciphers, HSTS
- **Reverse Proxy**: `/api/` → main-api, `/ws` → WebSocket upgrade, `/uploads/` → file serving, `/widget.js` → widget script
- **SPA Fallback**: Frontend routing via `try_files`
- **Auto Self-Signed Cert**: `entrypoint.sh` generates cert jika tidak ada di `nginx/ssl/`

---

## Monitoring & Observability

### Sentry (Error Tracking)
- Semua layanan terintegrasi Sentry (aktifkan via `SENTRY_DSN` env var)
- Main API: middleware `app.onError`, adapters: process-level handlers (`unhandledRejection`, `uncaughtException`)

### Pino (Structured Logging)
- JSON structured logs, level konfigurabel via `LOG_LEVEL`
- Request ID propagation via `X-Request-Id` header
- Child logger per-request dengan konteks (method, path, status)

### Prometheus + Grafana
- **Metrics endpoint**: `GET /metrics` (main-api)
- **Custom metrics**:
  - `http_requests_total` (Counter: method, path, status)
  - `http_request_duration_seconds` (Histogram: method, path, status)
  - Default runtime metrics (memory, CPU, GC)
- **Grafana dashboards** (auto-provisioned):
  - HTTP Request Rate per status
  - HTTP p95 Latency
  - Total HTTP Requests
  - CPU Usage
  - Memory Usage (RSS)
- **Ports**: Prometheus 9090, Grafana 3000 (admin/admin)

### Health Check Endpoints
- **Main API**: `GET /healthz` — cek DB + Redis, return JSON status + uptime
- **WA Adapter**: `GET /health` — cek Redis, session statuses per inbox
- **Email Adapter**: `GET /health` — cek Redis, uptime
- **Telegram Adapter**: `GET /health` — cek DB + Redis

### Health Check Script
```bash
./monitoring/health-check.sh
```

---

## Testing

```bash
# Semua test
bun test

# Per layanan
bun test:main-api       # Bun test runner — 23 test files
bun test:frontend       # Vitest — component tests
bun test:wa-adapter     # Bun test runner — auth state tests
```

### Coverage Test Main API

| Kategori | Test Files |
|---|---|
| **Security** | critical-routes, conversations-security, require-permission, path-traversal, crypto-security, widget-cors, viewers-security, exports-security |
| **Features** | conversations-assignment, messages-reply, incoming-message-status, search, collision |
| **Chatbot** | chatbot-db, chatbot-eval, chatbot-validation |
| **AI** | ai, ai-validation |
| **Automation** | automation |
| **Infra** | healthz, request-id, webhooks, api-keys-validation |

---

## Backup & Recovery

### Backup Script
```bash
./scripts/backup.sh
```

- **PostgreSQL**: `pg_dump` → compressed `.sql.gz`
- **Retensi**: 7 hari (konfigurabel via `RETENTION_DAYS`)
- **Automated**: Tambahkan ke cron untuk backup harian (e.g. jam 02:00)
- **Log**: `$BACKUP_DIR/backup.log`

### Restore
```bash
# Lokal
gunzip -c backup_omni_20260614.sql.gz | psql -U user -d omnichannel

# Remote
gunzip -c backup.sql.gz | psql "postgres://user:pass@remote:5432/omnichannel"
```

### Redis Persistence
- RDB snapshots: setiap 60 detik jika ada 1 perubahan (`--save 60 1`)
- AOF append-only: enabled (`--appendonly yes`)

---

## Keputusan Teknis

### Kenapa Bun untuk Main API, Node.js untuk WA Adapter?
Library Baileys bergantung pada modul internal Node.js (`crypto`, `net`) yang memiliki masalah kompatibilitas dengan Bun. Main API menggunakan Bun untuk kecepatan maksimal pada IO-bound operations.

### Kenapa Raw SQL tanpa ORM?
Mencegah *memory bloat* saat menangani jutaan baris pesan. `postgres.js` dengan Tagged Template Literals sudah aman dari SQL injection dan sangat efisien.

### Kenapa Redis dipisah 4 koneksi?
Perintah `brpop` bersifat *blocking* — jika menggunakan koneksi yang sama dengan API handler, seluruh server Hono akan *hang*. Koneksi Pub/Sub (`subscribe`) juga bersifat monopolistik. Pemisahan `redis` / `redisSub` / `redisWorker` / `redisWebhookWorker` mencegah deadlock.

### Kenapa Conversation & Ticket dipisah?
`conversations` adalah wadah abadi untuk seluruh histori interaksi antara pelanggan dan inbox. `tickets` adalah siklus hidup spesifik sebuah issue yang bisa dibuka-tutup berulang kali dalam conversation yang sama. Ini memungkinkan riwayat yang tidak pernah hilang.

### JID Normalization (WhatsApp Multi-Device)
WhatsApp multi-device sering merutekan pesan via `@lid` (Linked Device ID). WA Adapter memprioritaskan `remoteJidAlt` (`@s.whatsapp.net`) agar histori obrolan pelanggan tidak terpecah.

### Stateless WA Auth
Kredensial Baileys disimpan di PostgreSQL (`whatsapp_auth_states`), bukan filesystem. Ini memungkinkan WA Adapter di-deploy dalam container Docker tanpa risiko kehilangan sesi. Migration otomatis dari filesystem ke PostgreSQL tersedia.

### Echo Detection (WA Adapter)
Pesan yang dikirim dari dashboard disimpan di `sentCache` (60 detik TTL). Saat Baileys menerima echo dari server WA (`fromMe = true`), adapter mengecek cache untuk menghindari duplikasi. Pesan `fromMe` yang TIDAK ada di cache dianggap dikirim manual dari HP (`is_host_echo`).

### Audit Trail & Dual-Write
Setiap perubahan status tiket menghasilkan dual-write: log analitik di `conversation_events` + pesan visual di `messages` (`sender_type = 'System'`).

### Widget: Preact + Shadow DOM
Widget menggunakan Preact (~3KB vs React ~40KB) untuk ukuran bundle minimal. Shadow DOM memberikan isolasi CSS lengkap sehingga styling widget tidak konflik dengan situs host pelanggan.

### Multi-Session WA
WA Adapter mendukung multiple inbox/session WhatsApp via env `INBOXES` (JSON array) atau single mode via `INBOX_ID`. Setiap inbox memiliki socket Baileys dan queue Redis sendiri.

---

## Catatan untuk Kontributor

1. **JANGAN gunakan ORM** — Raw SQL dengan `postgres.js` Tagged Template Literals. Semua insert/update krusial harus dalam transaction (`sql.begin()`).

2. **JANGAN campur runtime** — `main-api` & `telegram-adapter` = Bun, `wa-adapter` & `email-adapter` = Node.js. Jangan paksa `bun` di wa-adapter.

3. **Selalu filter `account_id`** — Setiap query ke tabel data wajib menyertakan `WHERE account_id = ...` untuk menjaga isolasi multi-tenancy.

4. **Validasi payload Redis** — Semua data yang lewat Redis harus divalidasi dengan Zod schema di `packages/shared-types`.

5. **Periksa message dumps** — Sebelum menambahkan dukungan tipe pesan baru, aktifkan `ENABLE_MESSAGE_DUMPS=true` dan periksa raw payload JSON di `apps/wa-adapter/message_dumps/`.

6. **API Documentation** — Swagger UI tersedia di endpoint `/api/docs` saat main-api berjalan.

7. **Environment Variables** — Frontend menggunakan `import.meta.env` (prefix `VITE_`). Jangan hardcode URL.

8. **Redis Connection Rules** — Jangan pernah memanggil `brpop`/`subscribe` pada instance `redis` utama. Gunakan `redisWorker`/`redisWebhookWorker` untuk blocking ops dan `redisSub` untuk Pub/Sub.

9. **Adapter Pattern** — Semua adapter mengikuti pola yang sama: incoming → validate Zod → `rpush queue:incoming_messages`, outgoing → `brpop queue:outgoing_messages:inbox_{id}` → kirim via channel API → push status update.

---

## Lisensi

Private — Hak cipta dilindungi.