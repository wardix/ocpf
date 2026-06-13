# Skema Database Platform Omnichannel (Relational ERD)

Dokumen ini mendefinisikan struktur database utama (menggunakan paradigma Relational Database seperti PostgreSQL) untuk membangun platform omnichannel customer support. 

Konsep utama di sini adalah **Multi-tenancy**, di mana hampir setiap tabel memiliki kolom `account_id` untuk memastikan pemisahan data antar perusahaan/tenant yang menggunakan platform.

## 1. Tabel Inti (Core & Users)

### `accounts`
Tabel level tertinggi yang mewakili satu perusahaan/tenant.
*   `id` (Primary Key)
*   `name` (String) - Nama perusahaan (Misal: "PT Toko Maju")
*   `created_at` (Timestamp)
*   `updated_at` (Timestamp)

### `users`
Tabel untuk menyimpan data staf/agen yang akan login ke dashboard.
*   `id` (Primary Key)
*   `name` (String)
*   `email` (String, Unique)
*   `password_hash` (String)
*   `created_at` (Timestamp)
*   `updated_at` (Timestamp)

### `account_users` (Pivot Table / Join Table)
Menghubungkan `users` dengan `accounts`. Seorang user bisa berada di banyak akun (misal: sebagai konsultan di beberapa perusahaan). Di sinilah *Role* ditentukan.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `user_id` (Foreign Key -> users.id)
*   `role` (Enum: 'administrator', 'agent')
*   `availability_status` (Enum: 'online', 'busy', 'offline') - Status agen saat ini.

## 2. Tabel Saluran & Kontak (Routing & Contacts)

### `channels`
Tabel polimorfik atau penyimpan konfigurasi spesifik tiap platform (Misal: Token API WhatsApp, Script Web Widget).
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `name` (String) - Nama internal saluran
*   `provider_type` (Enum: 'whatsapp', 'telegram', 'facebook', 'web_widget', 'api')
*   `provider_config` (JSONB) - Menyimpan kredensial spesifik secara fleksibel (misal: API Key, Webhook Secret).

### `inboxes`
Tabel polimorfik atau penyimpan konfigurasi spesifik tiap platform (Misal: Token API WhatsApp, Script Web Widget).
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `channel_id` (Foreign Key -> channels.id)
*   `name` (String) - (Misal: "WA CS Jakarta")
*   `greeting_message` (Text) - Pesan sapaan otomatis.

### `inbox_settings`
Menyimpan konfigurasi fitur tambahan per-inbox, seperti pengaturan Auto-Assignment.
*   `id` (Primary Key)
*   `inbox_id` (Foreign Key -> inboxes.id, Unique)
*   `account_id` (Foreign Key -> accounts.id)
*   `auto_assignment_enabled` (Boolean) - Menentukan apakah pesan masuk ke inbox ini dialokasikan otomatis ke agen.
*   `auto_assignment_algorithm` (Enum/String: 'round_robin', 'least_busy') - Algoritma pembagian tiket.
*   `auto_assignment_max_tickets` (Integer) - Batas maksimum tiket aktif per agen sebelum dilewati oleh auto-assignment.
*   `last_assigned_user_id` (Foreign Key -> users.id, Nullable) - Menyimpan ID agen terakhir yang menerima penugasan (untuk algoritma Round Robin).
*   `updated_at` (Timestamp)


### `contacts`
Tabel pelanggan yang menghubungi sistem.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `name` (String)
*   `email` (String, Nullable)
*   `phone_number` (String, Nullable)
*   `avatar_url` (String, Nullable)
*   `custom_attributes` (JSONB) - Data tambahan yang dinamis.
*   `search_vector` (TSVector, Nullable) - Vektor penelusuran berindeks GIN.

### `contact_inboxes` (Pivot Table)
Menghubungkan kontak dengan inbox tertentu (seorang kontak di WA mungkin punya ID yang berbeda dengan di Facebook).
*   `id` (Primary Key)
*   `contact_id` (Foreign Key -> contacts.id)
*   `inbox_id` (Foreign Key -> inboxes.id)
*   `source_id` (String) - ID unik dari platform asli (Misal: nomor WA pelanggan, atau ID Facebook Messenger).

### `whatsapp_auth_states`
Menyimpan state otentikasi Baileys untuk WhatsApp Adapter. Ini memungkinkan `wa-adapter` berjalan secara *stateless* dan persisten di dalam kontainer Docker.
*   `inbox_id` (Integer) - Menandakan akun WA mana yang dihubungkan
*   `key` (String) - Kunci data auth (e.g. 'creds', 'app-state-sync-key')
*   `data` (JSONB) - Nilai state yang di-serialize
*   `PRIMARY KEY (inbox_id, key)`

## 3. Tabel Percakapan & Tiket (Conversations & Tickets)

### `conversations`
Tabel untuk menyimpan wadah sesi obrolan (percakapan abadi / berkelanjutan) antara kontak dan inbox.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `inbox_id` (Foreign Key -> inboxes.id)
*   `contact_id` (Foreign Key -> contacts.id)
*   `created_at` (Timestamp)
*   `updated_at` (Timestamp)

### `tickets`
Tabel untuk sesi penanganan masalah yang memiliki siklus hidup (lifecycle). Satu percakapan bisa memiliki banyak tiket dari waktu ke waktu.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `assignee_id` (Foreign Key -> users.id, Nullable) - Agen yang menangani.
*   `status` (Enum: 'open', 'pending', 'snoozed', 'resolved')
*   `is_bot_active` (Boolean) - Menandakan apakah chatbot sedang menangani tiket ini.
*   `bot_state` (String) - Node/State terkini dari FSM chatbot pelanggan ini.
*   `snoozed_until` (Timestamp, Nullable) - Jika statusnya snoozed.
*   `created_at` (Timestamp)
*   `updated_at` (Timestamp)
*   `resolved_at` (Timestamp, Nullable)

### `messages`
Tabel yang menyimpan setiap baris pesan di dalam sebuah percakapan. Tabel ini akan sangat besar volumenya.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `ticket_id` (Foreign Key -> tickets.id)
*   `sender_type` (Enum: 'Contact', 'User', 'System') - Siapa yang mengirim.
*   `sender_id` (Integer) - ID dari Contact atau User yang mengirim.
*   `content` (Text, Nullable) - Teks pesan.
*   `message_type` (Enum: 'incoming', 'outgoing', 'template') - Arah pesan.
*   `is_private` (Boolean) - `true` jika ini adalah *Private Note* antar agen.
*   `status` (Enum: 'sent', 'delivered', 'read', 'failed') - Status pengiriman ke platform asli.
*   `wa_message_id` (String, Nullable) - ID spesifik pesan dari WhatsApp.
*   `reply_to_message_id` (Foreign Key -> messages.id, Nullable) - ID pesan internal yang sedang dibalas/di-quote.
*   `search_vector` (TSVector, Nullable) - Vektor penelusuran berindeks GIN untuk pencarian teks penuh (*Full-Text Search*).
*   `created_at` (Timestamp)

### `attachments` (Polymorphic)
Menyimpan file media yang diunggah.
*   `id` (Primary Key)
*   `message_id` (Foreign Key -> messages.id)
*   `file_type` (String) - Mime type (image/png, application/pdf).
*   `file_url` (String) - URL lokasi file (S3, lokal).
*   `original_filename` (String, Nullable) - Nama file asli sebelum disanitasi.

### `conversation_events` (Audit Trail)
Tabel untuk mencatat log aktivitas atau perubahan status pada percakapan.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `ticket_id` (Foreign Key -> tickets.id, Nullable)
*   `actor_type` (String) - Siapa yang melakukan aksi ('User', 'Contact', 'System').
*   `actor_id` (BIGINT, Nullable) - ID dari aktor yang melakukan aksi.
*   `event_type` (String) - Jenis kejadian (misal: 'status_changed').
*   `event_data` (JSONB) - Data tambahan (misal: `{ "old_status": "open", "new_status": "resolved" }`).
*   `created_at` (Timestamp)

### `csat_ratings` (Customer Satisfaction)
Tabel untuk mencatat hasil survei kepuasan pelanggan terhadap layanan agen.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `ticket_id` (Foreign Key -> tickets.id, Unique)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `contact_id` (Foreign Key -> contacts.id)
*   `assigned_agent_id` (Foreign Key -> users.id, Nullable) - Agen yang menangani tiket tersebut.
*   `rating` (Integer, 1-5) - Nilai kepuasan dari pelanggan (1 = Sangat Buruk, 5 = Sangat Baik).
*   `feedback` (Text, Nullable) - Umpan balik opsional tertulis.
*   `created_at` (Timestamp)

## 4. Tabel Organisasi Tambahan (Tags & Teams)


### `canned_responses`
Tabel untuk menyimpan template balasan cepat yang bisa digunakan agen.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `short_code` (String) - Kode panggil (Misal: "salam", tanpa garis miring).
*   `content` (Text) - Isi pesan template.
*   `created_at` (Timestamp)

### `labels`
Tabel tag/label untuk kategorisasi.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `title` (String) - (Misal: "VIP", "Bug")
*   `color` (String) - Hex code (Misal: "#FF0000")

### `conversation_labels` (Pivot Table)
Menghubungkan `conversations` dengan `labels`.
*   `conversation_id` (Foreign Key -> conversations.id)
*   `label_id` (Foreign Key -> labels.id)

---
*Catatan Penting:* Kolom tipe `JSONB` pada tabel `channels` dan `contacts` sangat disarankan jika Anda menggunakan PostgreSQL, karena memberikan fleksibilitas skema tanpa perlu banyak operasi `ALTER TABLE` di masa depan.ikan fleksibilitas skema tanpa perlu banyak operasi `ALTER TABLE` di masa depan.