#!/bin/bash
# ==============================================================================
# OCPF Database Backup Script
# ==============================================================================
# Script ini digunakan untuk mencadangkan database PostgreSQL (pg_dump),
# mengompres hasilnya (gzip), mencatat logs, dan melakukan rotasi otomatis
# terhadap cadangan lama yang melebihi batas retensi (default: 7 hari).
# ==============================================================================

# Definisikan direktori dasar proyek (satu tingkat di atas direktori script)
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Konfigurasi Backup
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:-postgres://omni:omni_password@localhost:5432/omni}"

# Buat folder backup dan log jika belum ada
mkdir -p "$BACKUP_DIR"
LOG_FILE="$BACKUP_DIR/backup.log"

# Inisialisasi Penamaan File
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_omni_${TIMESTAMP}.sql.gz"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "Memulai proses pencadangan database..."

# Cek apakah command pg_dump tersedia
if ! command -v pg_dump &> /dev/null; then
  log "ERROR: pg_dump tidak ditemukan di sistem. Proses pencadangan dibatalkan." >&2
  exit 1
fi

# Jalankan pg_dump dengan koneksi langsung dari DATABASE_URL
if pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"; then
  log "SUKSES: Database berhasil dicadangkan ke: $BACKUP_FILE"
  
  # Rotasi Backup (Hapus file backup yang lebih lama dari RETENTION_DAYS hari)
  log "Memeriksa rotasi cadangan lama (retensi: $RETENTION_DAYS hari)..."
  deleted_count=0
  
  # Temukan dan hapus file backup lama
  while IFS= read -r file; do
    if [ -f "$file" ]; then
      rm -f "$file"
      log "ROTASI: Menghapus cadangan usang: $(basename "$file")"
      deleted_count=$((deleted_count + 1))
    fi
  done < <(find "$BACKUP_DIR" -name "backup_omni_*.sql.gz" -type f -mtime +"$RETENTION_DAYS")
  
  log "Proses rotasi selesai. $deleted_count file cadangan lama dihapus."
  exit 0
else
  log "ERROR: pg_dump gagal dijalankan. Silakan periksa status database atau DATABASE_URL." >&2
  # Hapus file cadangan parsial jika ada
  rm -f "$BACKUP_FILE"
  exit 1
fi
