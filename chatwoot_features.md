# Daftar Fitur Platform Omnichannel Customer Support (Referensi: Chatwoot)

Dokumen ini memuat daftar fitur utama yang diperlukan untuk membangun platform *omnichannel customer support* yang lengkap. Fitur-fitur ini dikelompokkan berdasarkan area fungsionalitasnya.

## A. Core Messaging & Inbox (Pesan & Kotak Masuk Inti)

*   **Shared Inbox Interface:** Antarmuka dengan tata letak 3 kolom:
    1.  Daftar Percakapan (kiri).
    2.  Ruang Obrolan/Pesan (tengah).
    3.  Informasi Kontak/Pelanggan & Widget Integrasi (kanan).
*   **Real-time Sync:** Pembaruan pesan masuk dan keluar secara instan menggunakan teknologi *WebSocket*.
*   **Conversation Lifecycle (Siklus Percakapan):** Manajemen status obrolan, meliputi:
    *   *Open* (Aktif/Belum selesai)
    *   *Pending* (Menunggu pelanggan)
    *   *Snoozed* (Ditunda hingga waktu tertentu)
    *   *Resolved* (Selesai/Ditutup)
*   **Assignment System:** Kemampuan untuk mendelegasikan (*assign*) percakapan kepada:
    *   Diri sendiri
    *   Agen lain
    *   Sebuah *Team* (Departemen)
*   **Collision Detection:** Indikator visual *real-time* yang memberitahu jika ada Agen lain yang sedang melihat atau mengetik balasan di percakapan yang sama, untuk mencegah balasan ganda.
*   **Rich Media Support:** Dukungan untuk mengirim dan menerima lampiran file, gambar, video, pesan suara (*voice notes*), dan dokumen.

## B. Channels Integration (Integrasi Sumber Pesan)

*   **Web Live Chat Widget:** *Script* Javascript yang dapat di-*embed* (disematkan) pada situs web milik pengguna, memungkinkan pengunjung web untuk langsung memulai percakapan.
*   **Email:** Integrasi protokol IMAP/SMTP untuk menerima dan merespons email secara langsung melalui antarmuka obrolan (*chat-like interface*).
*   **WhatsApp:** Integrasi penuh menggunakan *WhatsApp Cloud API* resmi (dari Meta) atau melalui penyedia pihak ketiga (seperti Twilio, 360Dialog).
*   **Social Media:** Integrasi dengan pesan masuk dari:
    *   Facebook Messenger
    *   Instagram DM (Direct Messages)
    *   Twitter/X (Mention & DM)
*   **Platform Pesan Lainnya:** Dukungan untuk Telegram, Line, SMS.
*   **API Channel (Custom Channel):** Fitur yang memungkinkan *developer* untuk menghubungkan sumber pesan kustom mereka sendiri (contoh: mengintegrasikan pesan dari aplikasi *mobile* internal).

## C. Agent Productivity (Produktivitas Agen)

*   **Keyboard Shortcuts:** Pintasan papan ketik untuk navigasi aplikasi yang cepat tanpa menggunakan *mouse*.
*   **Canned Responses:** Template atau *snippet* pesan yang sudah disimpan sebelumnya untuk menjawab pertanyaan umum dengan cepat.
*   **Macros:** Kumpulan aksi yang dapat dijalankan secara bersamaan dengan satu klik (misalnya: tambahkan label, kirim pesan penutup, dan ubah status jadi *Resolved* sekaligus).
*   **Mentions (@):** Kemampuan untuk men-tag (*mention*) Agen lain dalam *Private Note* (catatan internal) untuk meminta bantuan pada tiket tertentu.
*   **Contact Merging:** Fitur untuk menggabungkan dua atau lebih profil kontak yang berbeda menjadi satu profil tunggal, jika diketahui mereka adalah orang yang sama (misal: menggabungkan kontak WhatsApp X dengan Email Y).

## D. Automation & Routing (Otomatisasi & Perutean)

*   **Auto-assignment (Round Robin):** Algoritma yang mendistribusikan beban percakapan baru secara adil dan merata kepada Agen yang sedang berstatus *online*.
*   **Business Hours (Jam Kerja):** Pengaturan jam operasional spesifik untuk setiap *Inbox*. Dapat digunakan untuk memicu balasan otomatis saat pesan masuk di luar jam kerja.
*   **Automation Rules (Aturan Otomatis):** Mesin aturan (*If-This-Then-That*) untuk menjalankan tindakan spesifik berdasarkan kondisi (misal: Jika pesan dari "VIP", beri label "Prioritas" dan *assign* ke Tim Senior).
*   **CSAT (Customer Satisfaction Score):** Pengiriman survei kepuasan secara otomatis (seperti *rating* bintang dan komentar) kepada pelanggan segera setelah percakapan diselesaikan (*Resolved*).

## E. Reporting & Analytics (Pelaporan & Analitik)

*   **Dashboard Metrik Utama:** Menyediakan ringkasan performa secara visual, termasuk:
    *   *First Response Time* (Waktu respons pertama)
    *   *Resolution Time* (Waktu rata-rata penyelesaian masalah)
    *   *Conversation Volume* (Volume pesan masuk per channel)
*   **Agent Performance:** Laporan detail mengenai performa setiap Agen secara individual (berapa banyak tiket yang diselesaikan, kecepatan merespons, rata-rata *CSAT*).

## F. Developer & Ecosystem (Pengembang & Ekosistem)

*   **Webhooks:** Kemampuan untuk mengirim *HTTP POST request* secara *real-time* ke *server* eksternal milik pengguna ketika terjadi peristiwa (*event*) tertentu, misalnya: ada pesan baru, atau tiket telah selesai.
*   **Public REST API:** *Application Programming Interface* yang dapat diakses publik (dengan otentikasi) untuk melakukan operasi CRUD pada kontak, pesan, dan akun dari aplikasi perangkat lunak eksternal.