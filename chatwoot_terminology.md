# Terminologi Platform Omnichannel Customer Support (Referensi: Chatwoot)

Dokumen ini berisi daftar terminologi inti yang digunakan dalam pengembangan platform *omnichannel customer support* seperti Chatwoot. Istilah-istilah ini sangat penting sebagai dasar penamaan tabel di database (skema data) dan variabel di dalam kode.

## 1. Hierarki & Pengguna (Hierarchy & Users)

*   **Account (Akun / Tenant):** Entitas level tertinggi. Mewakili satu perusahaan atau organisasi. Dalam sistem SaaS (Multi-tenant), satu platform bisa memiliki banyak *Account*.
*   **User / Agent (Agen):** Staf atau karyawan yang login ke dashboard untuk melayani pelanggan. Biasanya memiliki *Role* (Peran) seperti `Administrator` (bisa mengubah pengaturan) atau `Agent` (hanya bisa membalas pesan).
*   **Team (Tim):** Pengelompokan dari beberapa *Agent*. Contoh: "Tim Sales", "Tim Support Tier 1", "Tim Finance". Berfungsi untuk memudahkan pendelegasian percakapan secara massal.

## 2. Sumber Data & Komunikasi (Routing & Communication)

*   **Channel (Saluran):** Platform pihak ketiga tempat pesan berasal. Contoh: WhatsApp, Facebook Messenger, Email, Twitter DM, Web Live Chat, API Kustom.
*   **Inbox (Kotak Masuk):** Instansi spesifik dari sebuah *Channel* yang terhubung ke sistem.
    *   *Catatan:* Channel adalah jenis platformnya (misal: "WhatsApp"), sedangkan Inbox adalah entitas spesifiknya (misal: "WA CS Jakarta" dan "WA CS Bandung"). Satu Channel bisa memiliki banyak Inbox.
*   **Contact (Kontak):** Profil pelanggan/pengguna akhir yang menghubungi sistem. Menyimpan data seperti Nama, Email, Nomor Telepon, dan riwayat interaksi.
*   **Conversation (Percakapan / Tiket):** Rangkaian komunikasi (sesi obrolan) antara *Contact* dan *Agent* yang terjadi di dalam suatu *Inbox*.
*   **Message (Pesan):** Satuan data obrolan tunggal (teks, gambar, lampiran file, lokasi) yang membentuk sebuah *Conversation*.

## 3. Alat Produktivitas Agen (Agent Workspace)

*   **Private Note (Catatan Internal):** Pesan antar *Agent* di dalam ruang obrolan pelanggan yang **tidak** terlihat oleh pelanggan. Berguna untuk koordinasi internal (biasanya ditandai dengan background warna kuning).
*   **Mention (@):** Fitur untuk "memanggil" *Agent* lain di dalam *Private Note* agar mereka mendapatkan notifikasi dan bisa membantu menjawab percakapan.
*   **Canned Response (Template Balasan):** Teks balasan standar yang sudah disimpan sebelumnya untuk FAQ. Biasanya dipanggil dengan *shortcut* garis miring (misal: `/salam`, `/alamat`).
*   **Macro (Makro):** Kumpulan perintah berantai yang bisa dieksekusi dengan satu klik.
    *   *Contoh:* Macro "Tutup Komplain" akan otomatis melakukan: Tambah tag `Komplain-Selesai` -> Kirim pesan "Terima kasih" -> Ubah status chat menjadi *Resolved*.
*   **Label / Tag:** Penanda (biasanya visual dengan warna) untuk mengkategorikan *Conversation* atau *Contact*. Contoh: `VIP`, `Bug Report`, `Urgent`.

## 4. Siklus Hidup & Otomatisasi (Lifecycle & Automation)

*   **Conversation Status (Status Percakapan):** Kondisi terkini dari sebuah obrolan. Status standar meliputi:
    *   *Open:* Percakapan aktif, belum selesai, atau butuh balasan agen.
    *   *Pending:* Menunggu balasan dari pelanggan atau pihak ke-3.
    *   *Snoozed:* Percakapan "ditunda" sementara dan akan muncul kembali (menjadi Open) pada waktu yang ditentukan.
    *   *Resolved:* Masalah pelanggan sudah selesai/ditutup.
*   **Assignment (Penugasan):** Proses memberikan kepemilikan sebuah *Conversation* kepada *Agent* tertentu atau *Team* tertentu.
*   **Automation Rule (Aturan Otomatis):** Sistem logika *If-This-Then-That* di latar belakang.
    *   *Contoh:* "JIKA pesan masuk di Inbox 'Email Support' DAN mengandung kata 'Refund', MAKA Assign ke 'Tim Finance' DAN beri Label 'Urgent'."
*   **Campaign (Kampanye Proaktif):** Pesan yang diinisiasi oleh sistem ke pelanggan. Sering digunakan di Live Chat Widget (contoh: Pop-up otomatis "Ada yang bisa dibantu?" setelah pengunjung diam di halaman selama 30 detik).
*   **CSAT (Customer Satisfaction Score):** Survei kepuasan pelanggan otomatis (rating bintang 1-5 dan komentar) yang dikirimkan sesaat setelah percakapan diubah statusnya menjadi *Resolved*.