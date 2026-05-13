# Arsitektur Chatbot Engine (Custom JSON)

Dokumen ini menjelaskan bagaimana mesin Chatbot internal bekerja di dalam Omnichannel Platform kita menggunakan konfigurasi file JSON statis.

## 1. Konsep Dasar (State Machine)

Chatbot ini beroperasi menggunakan konsep **Finite State Machine (FSM)**. Setiap percakapan pelanggan memiliki sebuah "State" (Status/Posisi) yang sedang aktif. 

Informasi ini disimpan di dalam tabel `conversations` menggunakan dua kolom baru:
*   `is_bot_active` (Boolean): Bernilai `true` jika chatbot sedang menangani percakapan. Bernilai `false` jika percakapan sudah dialihkan ke Agen manusia.
*   `bot_state` (String): Menyimpan ID State saat ini (misalnya: `"start"`, `"jam_operasional"`).

## 2. Struktur File `chatbot.json`

File konfigurasi `chatbot.json` adalah otak dari bot ini. Strukturnya terdiri dari `global_commands` dan kumpulan "Node" di dalam `states`:

```json
{
  "global_commands": {
    "!menu": "start"
  },
  "states": {
    "start": {
      "text": "Halo! Pilih 1 untuk Bantuan, 2 untuk Berbicara dengan Agen",
      "options": {
        "1": "menu_bantuan",
        "2": "transfer_cs"
      },
      "fallback": "start"
    },
    "transfer_cs": {
      "text": "Mohon tunggu, kami sedang menyambungkan Anda ke Agen...",
      "action": "assign_agent"
    }
  }
}
```

### Penjelasan Properti:
*   **`global_commands`**: Kumpulan kata kunci (seperti `!menu`). Jika pelanggan mengetik kata ini kapan saja (bahkan saat `is_bot_active` = `false` dan sedang ditangani agen), sistem akan langsung mengaktifkan bot kembali dan memindahkannya ke State yang dituju (misal: `"start"`).
*   **`text`**: Teks balasan otomatis yang akan dikirim bot. Ini dapat berupa **String** (untuk satu pesan tunggal) atau **Array of Strings** (untuk mengirim beberapa pesan secara berurutan).
    *   Contoh Array: `"text": ["Halo!", "Mohon tunggu sebentar ya..."]`
*   **`options`** *(opsional)*: Pemetaan input pelanggan ke State berikutnya. Jika pelanggan mengetik "1", maka `bot_state` akan berubah menjadi `"menu_bantuan"`.
*   **`fallback`** *(opsional)*: Jika input pelanggan tidak ada di dalam `options`, bot akan berpindah ke state `fallback` ini (biasanya digunakan untuk mengulang pesan menu).
*   **`action`** *(opsional)*: Perintah khusus untuk sistem. Saat ini yang didukung adalah `"assign_agent"`, yang akan mengubah `is_bot_active` menjadi `false` sehingga Agen manusia bisa mengambil alih.

## 3. Alur Kerja (Data Flow)

Berikut adalah apa yang terjadi di `main-api` ketika ada pesan masuk dari WhatsApp:

1.  **Penerimaan Pesan:** `processIncomingMessageToDB` menerima pesan pelanggan (misal: pelanggan mengetik "1").
2.  **Cek Status Bot:** Sistem mengekstrak percakapan aktif dari database.
    *   Jika `is_bot_active === false`, bot diam saja. (Agen manusia yang bertugas).
    *   Jika `is_bot_active === true`, lanjut ke langkah 3.
3.  **Evaluasi Input:**
    *   Sistem melihat `bot_state` pelanggan saat ini (misal: `"start"`).
    *   Sistem mencari Node `"start"` di dalam `chatbot.json`.
    *   Sistem mencocokkan teks pesan pelanggan ("1") dengan `options` di dalam Node `"start"`.
    *   Sistem menemukan bahwa "1" mengarah ke State `"menu_bantuan"`.
4.  **Eksekusi Transisi:**
    *   Sistem memperbarui `bot_state` di database menjadi `"menu_bantuan"`.
    *   Sistem mengambil `text` dari Node `"menu_bantuan"`.
    *   Sistem melakukan *Dual-Write*:
        *   Menyimpan pesan balasan bot ke tabel `messages` (dengan `sender_type = 'System'` atau `'Bot'`).
        *   Melemparkan pesan balasan bot tersebut ke antrean Redis `QUEUE_OUTGOING` agar `wa-adapter` mengirimkannya ke WhatsApp pelanggan.
5.  **Eksekusi Aksi (Handoff):**
    *   Jika Node tujuan memiliki `"action": "assign_agent"`, sistem akan mengubah `is_bot_active` menjadi `false`. 
    *   Pelanggan tidak akan menerima balasan otomatis lagi sampai Agen menyelesaikan tiket dan tiket baru terbuka (yang akan mereset `bot_state` ke `"start"`).

## 4. Eksekusi Sekuensial (Multi-API Call & Teks)

Untuk menangani skenario kompleks di mana satu `global_command` atau satu State harus membalas pesan, lalu menunggu hasil dari API eksternal A, lalu membalas lagi, dan memanggil API eksternal B, kita menggunakan arsitektur **Sequential Steps** (*Array of Objects*).

Alih-alih menggunakan properti `text` dan `api_call` yang terpisah, sebuah State dapat mendefinisikan daftar aksi di dalam properti `"steps"`. Sistem (Bot Engine) akan mengeksekusi array `"steps"` ini satu per satu secara berurutan dari atas ke bawah.

```json
{
  "proses_kompleks": {
    "steps": [
      {
        "type": "text",
        "content": "⏳ Mohon tunggu, saya sedang memeriksa data Anda..."
      },
      {
        "type": "api_call",
        "url": "https://api.system-a.com/check/{{phone_number}}",
        "method": "GET",
        "store_response_as": "api_A"
      },
      {
        "type": "text",
        "content": "Data Anda di Sistem A valid dengan status: {{api_A.status}}. Sekarang saya akan mendaftarkannya ke Sistem B..."
      },
      {
        "type": "api_call",
        "url": "https://api.system-b.com/register",
        "method": "POST",
        "body": {
          "user_id": "{{api_A.user_id}}"
        },
        "on_failure": {
          "target_state": "gagal_daftar"
        }
      },
      {
        "type": "text",
        "content": "✅ Proses selesai! Anda telah berhasil didaftarkan."
      }
    ],
    "options": {
      "0": "start"
    }
  }
}
```

### Keunggulan Arsitektur "Steps":
1.  **Eksekusi Real-time:** Setiap objek `{ "type": "text" }` di dalam *array* akan langsung dikirimkan ke WhatsApp saat itu juga. Pelanggan akan merasa seperti sedang berinteraksi langsung karena mereka menerima pesan secara bertahap saat bot sedang memproses API di latar belakang.
2.  **Context Sharing (`store_response_as`):** Respons JSON dari pemanggilan API pertama (`api_A`) disimpan di memori sementara. Variabel ini bisa langsung dilemparkan (*interpolate*) ke dalam teks pesan berikutnya atau digunakan sebagai *body parameter* untuk pemanggilan API (`api_B`) selanjutnya di dalam State yang sama.
3.  **Henti di Tengah Jalan (Abort):** Jika salah satu objek `"type": "api_call"` mengalami kegagalan dan memiliki konfigurasi `"on_failure"`, eksekusi sekuens/langkah berikutnya akan langsung dibatalkan (di- *abort*), dan *state* percakapan akan langsung melompat ke `target_state` yang ditentukan.

## 5. Skenario Penggunaan Lanjutan: Integrasi AI (LLM)

Kombinasi fitur **Global Commands**, **Wildcard Input (`*`)**, dan **API Call** memungkinkan Anda membuat mode obrolan AI yang sangat cerdas di mana bot sepenuhnya mengambil alih menggunakan API eksternal (seperti OpenAI atau Gemini API) sampai pelanggan memutuskan untuk berhenti.

**Skenario:**
1. Tiket sedang ditangani oleh Agen manusia (`is_bot_active = false`).
2. Pelanggan mengetikkan `/start_ai`.
3. Sistem menangkap *Global Command* ini, mengaktifkan bot, dan memindahkan state ke `ai_mode`.
4. Di dalam state `ai_mode`, setiap input pelanggan akan ditangkap oleh wildcard `*` dan memicu HTTP Request ke server LLM eksternal Anda.
5. Pesan balasan dari LLM ditampilkan ke pelanggan, dan state akan berulang kembali (loop) ke `ai_mode`.
6. Jika pelanggan mengetik `/end_ai`, *Global Command* lain memicu perpindahan state ke `exit_ai` yang akan menonaktifkan bot dan memanggil Agen kembali.

**Contoh Konfigurasi `chatbot.json` untuk Skenario Ini:**

```json
{
  "global_commands": {
    "/start_ai": "ai_mode",
    "/end_ai": "exit_ai"
  },
  "states": {
    "ai_mode": {
      "text": "", 
      "options": {
        "*": "process_ai"
      }
    },
    "process_ai": {
      "text": "⏳ AI sedang berpikir...",
      "api_call": {
        "url": "https://api.your-llm-service.com/generate",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json",
          "Authorization": "Bearer token-rahasia"
        },
        "body": {
          "prompt": "{{user_input}}",
          "user_id": "{{phone_number}}"
        },
        "on_success": {
          "condition": "response.reply",
          "target_state": "ai_reply_received"
        },
        "on_failure": {
          "target_state": "ai_mode"
        }
      }
    },
    "ai_reply_received": {
      "text": "{{api_response.reply}}", 
      "options": {
        "*": "process_ai"
      }
    },
    "exit_ai": {
      "text": "Anda telah keluar dari mode AI. Seorang Agen manusia akan segera membantu Anda.",
      "action": "assign_agent"
    }
  }
}
```

*Catatan: Fungsionalitas parsing `{{api_response.reply}}` dan `POST body` adalah gambaran konseptual arsitektur yang perlu didukung di tingkat `main-api` untuk mewujudkan skenario ini secara penuh.*