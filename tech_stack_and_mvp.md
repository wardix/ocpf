# Tech Stack & Minimum Viable Product (MVP) Plan

Dokumen ini merumuskan teknologi yang direkomendasikan untuk membangun platform omnichannel (berkaca pada kebutuhan *real-time* dan konkurensi tinggi), serta batasan fitur untuk rilis versi pertama (MVP - Minimum Viable Product).

---

## Bagian 1: Rekomendasi Tech Stack (Teknologi)

Berdasarkan preferensi teknis Anda, berikut adalah spesifikasi *stack* yang sangat modern, sangat cepat, dan efisien:

### 1. Backend (API & Business Logic)
*   **Runtime & Package Manager: Bun**
    *   *Alasan:* Bun sangat luar biasa cepat sebagai runtime JavaScript/TypeScript. Kemampuannya menjalankan TypeScript secara *native* tanpa perlu kompilasi tambahan (seperti `tsc`) sangat mempercepat *developer experience*.
*   **Framework API: Hono**
    *   *Alasan:* Hono adalah framework web yang sangat ringan dan super cepat (*Ultrafast*), dirancang khusus untuk berjalan optimal di atas lingkungan seperti Bun atau Edge (Cloudflare Workers). Sangat cocok untuk menangani *webhook* masuk dengan latensi serendah mungkin.

### 2. Frontend (Agent Dashboard & Web Widget)
*   **Dashboard UI Framework: React.js (atau Vite + React / Next.js)**
    *   *Alasan:* Ekosistem React sangat kuat untuk membangun *Single Page Application* (SPA) interaktif yang membutuhkan pembaruan UI *real-time* (seperti merender pesan masuk seketika).
*   **Styling & Komponen: DaisyUI (dengan Tailwind CSS)**
    *   *Alasan:* DaisyUI memberikan komponen siap pakai (seperti tombol, *modal*, tata letak) berbasis Tailwind CSS. Ini mempercepat pembuatan UI Dashboard (seperti desain 3 kolom untuk Inbox) tanpa harus menulis CSS dari nol, sekaligus menjaga ukuran *bundle* tetap kecil dan konsisten.

### 3. Database & Penyimpanan (Data Layer)
*   **Database Relasional: PostgreSQL (Raw SQL)**
    *   *Alasan:* Wajib untuk aplikasi SaaS *multi-tenant*. Menggunakan **Raw SQL** tanpa ORM (Object-Relational Mapping) memberikan kontrol absolut terhadap performa *query*, terutama saat data pesan sudah mencapai jutaan baris. Anda bisa menggunakan *driver* bawaan Bun atau `postgres.js` untuk mengeksekusi *raw query*.
    *   *FTS (Full-Text Search):* Kita memaksimalkan fitur bawaan PostgreSQL (`tsvector` & GIN Index) untuk sistem pencarian global, menghindari kompleksitas pemasangan *search engine* eksternal seperti Elasticsearch/OpenSearch di fase awal MVP.
*   **Message Broker / Cache / Pub-Sub: Redis**
    *   *Alasan:* Tetap menjadi komponen **krusial** meskipun menggunakan Bun. Digunakan untuk:
        1.  *Pub/Sub:* Menyiarkan pesan baru via WebSocket.
        2.  *Queueing:* Menerima *webhook* dari platform eksternal dengan cepat, dan menyerahkan proses penyimpanannya ke latar belakang.

### 4. Real-time Communication
*   **WebSocket: Bun Native WebSockets**
    *   *Alasan:* Bun memiliki dukungan server WebSocket bawaan yang sangat kencang. Kita bisa menggunakan `Bun.serve({ websocket: { ... } })` dikombinasikan dengan Hono untuk menangani obrolan *real-time* tanpa perlu library tambahan yang berat.

---

## Bagian 2: Minimum Viable Product (MVP) Scope - Versi 1.0

Untuk rilis awal, kita harus menghindari *over-engineering* dan fokus pada "Alur Inti" (Core Loop): *Pelanggan mengirim pesan -> Masuk ke sistem -> Agen membalas -> Pelanggan menerima balasan.*

### Fitur yang MASUK dalam MVP (Must Have)
1.  **Sistem Akun Dasar:** Login Agen & Admin (tanpa *Role-Based Access Control* yang rumit dulu).
2.  **Shared Inbox UI (DaisyUI):** Tampilan 3 kolom sederhana (Daftar Chat, Ruang Obrolan, Profil Kontak) yang dibangun menggunakan komponen DaisyUI.
3.  **Hanya 1 Channel Awal:**
    *   *WhatsApp Unofficial (via Baileys):* Menggunakan library `@whiskeysockets/baileys` agar pengguna dapat memindai QR Code untuk menghubungkan nomor WhatsApp biasa tanpa perlu proses persetujuan (approval) API resmi Meta.
4.  **Manajemen Pesan Dasar:** Mengirim pesan teks dan menerima/mengirim gambar.
5.  **Conversation Status:** Bisa mengubah status obrolan (*Open* -> *Resolved*).
6.  **Assignment Sederhana:** Menugaskan percakapan ke Agen spesifik (tanpa fitur Tim/Departemen dulu).

### Fitur yang DITUNDA untuk Fase Selanjutnya (Nice to Have)
*(Jangan bangun ini di MVP)*
1.  Automations (Aturan otomatis *If-This-Then-That*).
2.  Dashboard Analytics & Reporting yang kompleks.
3.  Integrasi Email & Social Media (Facebook/Instagram/Twitter).
4.  Fitur Makro (Macros) dan Canned Responses.
5.  Sistem Penagihan (Billing/Subscription) jika ini SaaS.

## Ringkasan Arsitektur Aliran Data (Microservice Pattern)
1.  **Incoming Message:** *WhatsApp Adapter Service* (berjalan di Node.js secara *stateless* karena manajemen sesinya disimpan di PostgreSQL) menerima *event* pesan masuk (`messages.upsert`) dari koneksi Baileys.
2.  **Queueing:** *Service* Node.js tersebut langsung memasukkan *payload* pesan mentah ke dalam antrean (Queue) Redis agar *socket* Baileys tidak terblokir.
3.  **Background Processing:** *Main API* (berjalan di Bun) yang bertindak sebagai *consumer*, mengambil *payload* dari antrean Redis -> Melakukan *Raw SQL Query* untuk mencari/membuat `Contact` di PostgreSQL -> Menyisipkan data `Message` baru.
4.  **Pub/Sub Broadcast:** Jika penyimpanan berhasil, *Main API* (Bun) mengirim *event* via Redis Pub/Sub.
5.  **WebSocket Push:** Bun Native WebSocket mendeteksi *event* tersebut dan mendorong data pesan baru ke Dashboard Agen.
6.  **Outgoing Message (Agen membalas):** Agen mengirim pesan dari Dashboard -> Diterima oleh Bun -> Disimpan ke Database -> Bun memasukkan perintah kirim pesan ke antrean Redis -> *WhatsApp Adapter Service* (Node.js) mengambil perintah tersebut dan mengirimkannya ke kontak via Baileys.aru di layar.