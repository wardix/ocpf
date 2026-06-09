# Panduan Backup, Restore & Disaster Recovery (DRP)

Dokumen ini berisi panduan teknis tentang strategi cadangan (backup), pemulihan data (restore), serta rencana penanganan bencana (Disaster Recovery Plan) untuk platform **Omnichannel Customer Support**.

---

## 1. Strategi Backup

Strategi backup kita didasarkan pada dua komponen penyimpanan utama:
1. **PostgreSQL**: Menyimpan seluruh data transaksional (akun, kontak, percakapan, tiket, pesan, log automasi, dll.).
2. **Redis/Valkey**: Menyimpan session tokens, status viewers (collision detection), queue pekerjaan, dan cache chatbot rules.

### A. Database PostgreSQL (Automated `pg_dump`)
Pencadangan dilakukan secara berkala menggunakan utilitas `pg_dump` dengan skrip otomatis [backup.sh](file:///home/wardix/agy/ocpf-flash/scripts/backup.sh).
- **Lokasi Cadangan**: `/home/wardix/agy/ocpf-flash/backups/` (dapat disesuaikan via env `BACKUP_DIR`).
- **Kompresi**: Format `.sql.gz` untuk menghemat ruang disk.
- **Kebijakan Rotasi**: Cadangan yang berusia lebih dari **7 hari** (dapat diubah via `RETENTION_DAYS`) akan dihapus secara otomatis saat backup baru dijalankan.

### B. Redis Persistence
Redis dikonfigurasi menggunakan strategi durabilitas ganda:
1. **RDB Snapshots**: Menyimpan snapshot biner dari dataset ke disk secara periodik. Konfigurasi `--save 60 1` memastikan snapshot dibuat setiap 60 detik jika minimal ada 1 perubahan kunci.
2. **AOF (Append Only File)**: Mencatat setiap operasi penulisan yang diterima oleh server. Parameter `--appendonly yes` memastikan riwayat transaksi Redis tercatat secara real-time dan diputar ulang saat container restart.

---

## 2. Cara Menjalankan Backup Manual

Untuk membuat cadangan PostgreSQL secara instan, jalankan skrip cadangan:

```bash
# Menggunakan kredensial default local
./scripts/backup.sh

# Kustomisasi target database dan folder output
DATABASE_URL="postgres://user:password@host:port/dbname" BACKUP_DIR="/path/to/backup" ./scripts/backup.sh
```

Hasil pencadangan akan tercatat pada berkas log: `/path/to/backup/backup.log`.

---

## 3. Otomatisasi Harian Menggunakan Cron

Agar backup berjalan otomatis setiap hari (misalnya pada pukul 02:00 dini hari saat traffic rendah), Anda dapat menambahkannya ke dalam penjadwalan `cron` sistem host Linux Anda.

### Langkah-langkah setup:
1. Buka konfigurasi crontab:
   ```bash
   crontab -e
   ```
2. Tambahkan baris konfigurasi berikut di bagian paling bawah:
   ```cron
   0 2 * * * /home/wardix/agy/ocpf-flash/scripts/backup.sh > /dev/null 2>&1
   ```
3. Simpan dan keluar dari editor. Cron daemon akan otomatis memuat konfigurasi baru ini.

---

## 4. Prosedur Restore (Pemulihan Data)

Jika terjadi kerusakan database atau kehilangan data, ikuti prosedur restore berikut untuk mengembalikan data dari file `.sql.gz`:

### A. Restore ke Database Docker (Local/Dev)
1. Salin atau pastikan file cadangan yang diinginkan tersedia di host.
2. Ekstrak file cadangan:
   ```bash
   gunzip -c backups/backup_omni_YYYYMMDD_HHMMSS.sql.gz > temp_restore.sql
   ```
3. Hapus database lama dan buat ulang database bersih (Opsional - lakukan ini jika ingin restore bersih):
   ```bash
   docker exec -i ocpf-postgres psql -U omni -d postgres -c "DROP DATABASE omni;"
   ```
   ```bash
   docker exec -i ocpf-postgres psql -U omni -d postgres -c "CREATE DATABASE omni;"
   ```
4. Jalankan perintah restore:
   ```bash
   docker exec -i ocpf-postgres psql -U omni -d omni < temp_restore.sql
   ```
5. Hapus file sql temporer:
   ```bash
   rm temp_restore.sql
   ```

### B. Restore ke Database Remote (Production)
```bash
gunzip -c backup_omni_YYYYMMDD_HHMMSS.sql.gz | psql "postgres://user:password@host:port/dbname"
```

---

## 5. Rencana Pemulihan Bencana (Disaster Recovery Plan)

Rencana Pemulihan Bencana (Disaster Recovery Plan / DRP) dirancang untuk memastikan kelangsungan operasional sistem jika terjadi kegagalan infrastruktur total (misal: kerusakan VM, kehilangan server cloud, dll.).

### Skenario Kegagalan Total & Langkah Pemulihan:

| Skenario | Dampak | Tindakan Pemulihan |
| :--- | :--- | :--- |
| **Kerusakan Database Transaksional** | PostgreSQL corrupt / tidak bisa booting | 1. Hentikan container API.<br>2. Hapus volume data `postgres_data`.<br>3. Nyalakan container DB bersih.<br>4. Lakukan langkah **Restore** dari file cadangan terakhir.<br>5. Restart seluruh container microservices. |
| **Kehilangan VM / Host Server** | Seluruh platform mati total | 1. Setup VM / Host baru dengan Docker & Docker Compose.<br>2. Clone repository codebase platform.<br>3. Siapkan file `.env` produksi.<br>4. Salin file cadangan database (`.sql.gz`) terbaru ke VM baru.<br>5. Jalankan `docker compose up -d postgres redis`.<br>6. Jalankan **Restore** database menggunakan file `.sql.gz`.<br>7. Jalankan sisa layanan menggunakan `docker compose up -d`. |
| **Redis Crash / Volume Redis Hilang** | Antrean pesan tertunda hilang | 1. Restart Redis container.<br>2. Redis otomatis memulihkan status key dari berkas AOF/RDB.<br>3. Jika data antrean hilang total, kirim event status sync ulang dari WA Adapter untuk sinkronisasi pesan tertunda. |

### Rekomendasi Tambahan (3-2-1 Backup Rule):
Untuk tingkat keamanan produksi yang lebih tinggi, disarankan untuk:
1. **Penyimpanan Offsite**: Salin file backup `.sql.gz` dari folder `backups/` ke cloud object storage eksternal (seperti AWS S3, Google Cloud Storage, atau MinIO) menggunakan script tambahan (misal `rclone` atau AWS CLI) setelah proses pencadangan di [backup.sh](file:///home/wardix/agy/ocpf-flash/scripts/backup.sh) selesai.
2. **Uji Coba Periodik**: Lakukan simulasi uji coba restore setidaknya sekali setiap bulan ke environment staging untuk memastikan integritas data cadangan tidak korup.
