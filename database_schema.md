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
*   `provider_type` (Enum: 'whatsapp', 'facebook', 'web_widget', 'api')
*   `provider_config` (JSONB) - Menyimpan kredensial spesifik secara fleksibel (misal: API Key, Webhook Secret).

### `inboxes`
Instansi spesifik dari sebuah Channel. 
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `channel_id` (Foreign Key -> channels.id)
*   `name` (String) - (Misal: "WA CS Jakarta")
*   `greeting_message` (Text) - Pesan sapaan otomatis.

### `contacts`
Tabel pelanggan yang menghubungi sistem.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `name` (String)
*   `email` (String, Nullable)
*   `phone_number` (String, Nullable)
*   `avatar_url` (String, Nullable)
*   `custom_attributes` (JSONB) - Data tambahan yang dinamis.

### `contact_inboxes` (Pivot Table)
Menghubungkan kontak dengan inbox tertentu (seorang kontak di WA mungkin punya ID yang berbeda dengan di Facebook).
*   `id` (Primary Key)
*   `contact_id` (Foreign Key -> contacts.id)
*   `inbox_id` (Foreign Key -> inboxes.id)
*   `source_id` (String) - ID unik dari platform asli (Misal: nomor WA pelanggan, atau ID Facebook Messenger).

## 3. Tabel Percakapan (Conversations)

### `conversations`
Tabel untuk menyimpan sesi obrolan / tiket.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `inbox_id` (Foreign Key -> inboxes.id)
*   `contact_id` (Foreign Key -> contacts.id)
*   `assignee_id` (Foreign Key -> users.id, Nullable) - Agen yang menangani.
*   `status` (Enum: 'open', 'pending', 'snoozed', 'resolved')
*   `snoozed_until` (Timestamp, Nullable) - Jika statusnya snoozed.
*   `created_at` (Timestamp)
*   `updated_at` (Timestamp)

### `messages`
Tabel yang menyimpan setiap baris pesan di dalam sebuah percakapan. Tabel ini akan sangat besar volumenya.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `sender_type` (Enum: 'Contact', 'User', 'System') - Siapa yang mengirim.
*   `sender_id` (Integer) - ID dari Contact atau User yang mengirim.
*   `content` (Text, Nullable) - Teks pesan.
*   `message_type` (Enum: 'incoming', 'outgoing', 'template') - Arah pesan.
*   `is_private` (Boolean) - `true` jika ini adalah *Private Note* antar agen.
*   `status` (Enum: 'sent', 'delivered', 'read', 'failed') - Status pengiriman ke platform asli.
*   `created_at` (Timestamp)

### `attachments` (Polymorphic)
Menyimpan file media yang diunggah.
*   `id` (Primary Key)
*   `message_id` (Foreign Key -> messages.id)
*   `file_type` (String) - Mime type (image/png, application/pdf).
*   `file_url` (String) - URL lokasi file (S3, lokal).

### `conversation_events` (Audit Trail)
Tabel untuk mencatat log aktivitas atau perubahan status pada percakapan.
*   `id` (Primary Key)
*   `account_id` (Foreign Key -> accounts.id)
*   `conversation_id` (Foreign Key -> conversations.id)
*   `actor_type` (String) - Siapa yang melakukan aksi ('User', 'Contact', 'System').
*   `actor_id` (BIGINT, Nullable) - ID dari aktor yang melakukan aksi.
*   `event_type` (String) - Jenis kejadian (misal: 'status_changed').
*   `event_data` (JSONB) - Data tambahan (misal: `{ "old_status": "open", "new_status": "resolved" }`).
*   `created_at` (Timestamp)

## 4. Tabel Organisasi Tambahan (Tags & Teams)

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
*Catatan Penting:* Kolom tipe `JSONB` pada tabel `channels` dan `contacts` sangat disarankan jika Anda menggunakan PostgreSQL, karena memberikan fleksibilitas skema tanpa perlu banyak operasi `ALTER TABLE` di masa depan.