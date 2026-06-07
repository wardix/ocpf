import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/crypto';
import { callAI, parseJSONResponse } from '../utils/ai';

export const aiRoutes = new Hono();

aiRoutes.use('/*', jwtMiddleware);

const aiConfigSchema = z.object({
  provider: z.enum(['openai', 'gemini']),
  api_key: z.string().optional(),
  model: z.string().min(1, 'Model wajib diisi'),
  max_tokens: z.number().int().min(10).max(2000).optional(),
  temperature: z.number().min(0.0).max(1.5).optional(),
  is_active: z.boolean().optional(),
  features_enabled: z.array(z.string()).optional()
});

// Helper: Format message history for prompt context
async function getConversationContext(conversationId: number, accountId: number, limit = 20) {
  const messages = await sql`
    SELECT sender_type, content, created_at
    FROM messages
    WHERE conversation_id = ${conversationId} AND account_id = ${accountId} AND is_private = false
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  // Return formatted chronologically
  return messages.reverse().map(m => {
    const role = m.sender_type === 'Contact' ? 'Customer' : m.sender_type;
    return `[${role}] ${m.content}`;
  }).join('\n');
}

// GET /api/settings/ai - Get current account AI Configuration & Usage Statistics (Admin only)
aiRoutes.get('/settings', async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak. Membutuhkan hak akses administrator.' }, 403);
    }

    const [config] = await sql`
      SELECT id, provider, model, max_tokens, temperature, is_active, features_enabled, created_at
      FROM ai_configs
      WHERE account_id = ${accountId} LIMIT 1
    `;

    // Calculate usage statistics
    const [usageStats] = await sql`
      SELECT 
        COUNT(*)::int as total_calls,
        COALESCE(SUM(tokens_input + tokens_output)::int, 0) as total_tokens,
        COALESCE(SUM(tokens_input)::int, 0) as input_tokens,
        COALESCE(SUM(tokens_output)::int, 0) as output_tokens
      FROM ai_usage_logs
      WHERE account_id = ${accountId} AND created_at >= NOW() - INTERVAL '30 days'
    `;

    // Hourly usage limit check
    const hourlyKey = `ai_limit:${accountId}:${new Date().getUTCHours()}`;
    const hourlyCalls = parseInt((await require('../config/redis').redis.get(hourlyKey)) || '0', 10);

    return c.json({
      success: true,
      data: {
        config: config || null,
        stats: {
          total_calls: usageStats?.total_calls || 0,
          total_tokens: usageStats?.total_tokens || 0,
          input_tokens: usageStats?.input_tokens || 0,
          output_tokens: usageStats?.output_tokens || 0,
          hourly_calls: hourlyCalls,
          hourly_limit: 50
        }
      }
    });
  } catch (error) {
    console.error('Error fetch AI settings:', error);
    return c.json({ error: 'Gagal mengambil konfigurasi AI' }, 500);
  }
});

// PUT /api/settings/ai - Save/update account AI configuration (Admin only)
aiRoutes.put('/settings', zValidator('json', aiConfigSchema, (result, c) => {
  if (!result.success) return c.json({ error: 'Validasi gagal', details: result.error.format() }, 400);
}), async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    if (jwtPayload?.role !== 'administrator') {
      return c.json({ error: 'Akses ditolak' }, 403);
    }

    const { provider, api_key, model, max_tokens, temperature, is_active, features_enabled } = c.req.valid('json');

    // Fetch existing configuration to check if we can reuse the key
    const [existingConfig] = await sql`
      SELECT api_key_encrypted FROM ai_configs WHERE account_id = ${accountId} LIMIT 1
    `;

    let encryptedKey: string;
    if (api_key && api_key !== '••••••••••••••••') {
      encryptedKey = encrypt(api_key);
    } else if (existingConfig && existingConfig.api_key_encrypted) {
      encryptedKey = existingConfig.api_key_encrypted;
    } else {
      return c.json({ error: 'API Key wajib diisi untuk konfigurasi pertama kali' }, 400);
    }

    const [savedConfig] = await sql`
      INSERT INTO ai_configs (
        account_id, provider, api_key_encrypted, model, max_tokens, temperature, is_active, features_enabled
      )
      VALUES (
        ${accountId}, ${provider}, ${encryptedKey}, ${model}, ${max_tokens || 500}, ${temperature || 0.7}, ${is_active !== undefined ? is_active : true}, ${features_enabled || ['smart_reply', 'summarize', 'auto_categorize']}
      )
      ON CONFLICT (account_id)
      DO UPDATE SET
        provider = EXCLUDED.provider,
        api_key_encrypted = EXCLUDED.api_key_encrypted,
        model = EXCLUDED.model,
        max_tokens = EXCLUDED.max_tokens,
        temperature = EXCLUDED.temperature,
        is_active = EXCLUDED.is_active,
        features_enabled = EXCLUDED.features_enabled,
        created_at = NOW()
      RETURNING id, provider, model, max_tokens, temperature, is_active, features_enabled
    `;

    return c.json({ success: true, data: savedConfig });
  } catch (error) {
    console.error('Error update AI settings:', error);
    return c.json({ error: 'Gagal memperbarui konfigurasi AI' }, 500);
  }
});

// POST /api/ai/suggest - Generate 3 quick reply suggestions
aiRoutes.post('/suggest', async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    const body = await c.req.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return c.json({ error: 'conversation_id wajib diisi' }, 400);
    }

    // Verify conversation ownership
    const [conv] = await sql`
      SELECT id FROM conversations WHERE id = ${conversation_id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!conv) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);

    const context = await getConversationContext(conversation_id, accountId, 20);

    const systemPrompt = `Anda adalah Asisten Virtual Pintar untuk tim Customer Service.
Tugas Anda adalah membaca alur obrolan antara pelanggan ([Customer]) dan agen/sistem ([User]/[System]), lalu membuat 3 (tiga) alternatif respon balasan cepat yang profesional, ringkas, sopan, dan ramah dalam bahasa yang digunakan oleh pelanggan (biasanya Bahasa Indonesia).
Return ONLY a valid JSON array of 3 strings containing the suggestions. Contoh format: ["Halo, ada yang bisa saya bantu?", "Baik, mohon tunggu sebentar ya.", "Terima kasih atas masukannya."].
Do NOT wrap the response in markdown blocks or write any explanation.`;

    const promptText = `Berikut adalah riwayat percakapan terakhir:\n\n${context}\n\nBerikan 3 alternatif respon balasan cepat.`;

    try {
      const response = await callAI(accountId, jwtPayload.id, 'smart_reply', promptText, systemPrompt);
      const suggestions = parseJSONResponse(response);
      return c.json({ success: true, data: Array.isArray(suggestions) ? suggestions : [] });
    } catch (aiErr: any) {
      if (aiErr.message === 'AI_RATE_LIMIT_EXCEEDED') {
        return c.json({ error: 'Batas kuota penggunaan AI (50 panggilan per jam) telah tercapai.' }, 429);
      }
      return c.json({ error: aiErr.message || 'Gagal menghasilkan saran AI' }, 400);
    }
  } catch (error) {
    console.error('Error in smart reply suggestion:', error);
    return c.json({ error: 'Gagal memproses saran balasan cepat' }, 500);
  }
});

// POST /api/ai/summarize - Summarize long conversation
aiRoutes.post('/summarize', async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    const body = await c.req.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return c.json({ error: 'conversation_id wajib diisi' }, 400);
    }

    const [conv] = await sql`
      SELECT id FROM conversations WHERE id = ${conversation_id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!conv) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);

    const context = await getConversationContext(conversation_id, accountId, 50);

    const systemPrompt = `Tugas Anda adalah merangkum percakapan antara pelanggan ([Customer]) dan agen ([User]/[System]).
Buatlah ringkasan singkat (maksimal 2 kalimat) dan daftar poin-poin utama yang dibahas (maksimal 4 poin).
Output harus berupa JSON dengan struktur: { "summary": "Rangkuman teks...", "key_points": ["Poin 1", "Poin 2", "Poin 3"] }.
Return ONLY the JSON. Do NOT write markdown, explanations, or wrap output in code blocks.`;

    const promptText = `Rangkum riwayat percakapan berikut:\n\n${context}`;

    try {
      const response = await callAI(accountId, jwtPayload.id, 'summarize', promptText, systemPrompt);
      const summaryObj = parseJSONResponse(response);
      return c.json({ success: true, data: summaryObj });
    } catch (aiErr: any) {
      if (aiErr.message === 'AI_RATE_LIMIT_EXCEEDED') {
        return c.json({ error: 'Batas kuota penggunaan AI (50 panggilan per jam) telah tercapai.' }, 429);
      }
      return c.json({ error: aiErr.message || 'Gagal membuat rangkuman' }, 400);
    }
  } catch (error) {
    console.error('Error in summarization:', error);
    return c.json({ error: 'Gagal memproses rangkuman' }, 500);
  }
});

// POST /api/ai/categorize - Automatically categorize conversation using active labels
aiRoutes.post('/categorize', async (c) => {
  try {
    const accountId = getAccountId(c);
    const jwtPayload = c.get('jwtPayload') as any;
    const body = await c.req.json();
    const { conversation_id } = body;

    if (!conversation_id) {
      return c.json({ error: 'conversation_id wajib diisi' }, 400);
    }

    const [conv] = await sql`
      SELECT id FROM conversations WHERE id = ${conversation_id} AND account_id = ${accountId} LIMIT 1
    `;
    if (!conv) return c.json({ error: 'Percakapan tidak ditemukan' }, 404);

    // Fetch available labels for this account
    const labels = await sql`
      SELECT id, title FROM labels WHERE account_id = ${accountId}
    `;

    if (labels.length === 0) {
      return c.json({ success: true, data: [], message: 'Tidak ada label terkonfigurasi untuk pencocokan.' });
    }

    const labelsList = labels.map(l => `"${l.title}"`).join(', ');
    const context = await getConversationContext(conversation_id, accountId, 10);

    const systemPrompt = `Anda adalah sistem kategorisasi tiket otomatis.
Tugas Anda adalah membaca pesan terakhir dari pelanggan, lalu memilih label/tag mana yang paling relevan dari daftar label berikut: [ ${labelsList} ].
Output harus berupa valid JSON array of objects yang berisi nama label dan nilai tingkat kepercayaan (confidence score) dari 0.0 sampai 1.0.
Format output: [ { "label": "Nama Label", "confidence": 0.85 } ].
Pilih label yang paling cocok saja (maksimal 2 label teratas dengan confidence > 0.5).
Return ONLY the JSON. Do NOT write markdown code blocks or explanations.`;

    const promptText = `Rekomendasikan label yang cocok untuk riwayat percakapan berikut:\n\n${context}`;

    try {
      const response = await callAI(accountId, jwtPayload.id, 'auto_categorize', promptText, systemPrompt);
      const suggestions = parseJSONResponse(response);
      
      // Map suggested label titles back to IDs
      const mappedSuggestions = (Array.isArray(suggestions) ? suggestions : [])
        .map((s: any) => {
          const match = labels.find(l => l.title.toLowerCase() === s.label.toLowerCase());
          return match ? { id: Number(match.id), title: match.title, confidence: s.confidence } : null;
        })
        .filter(Boolean);

      return c.json({ success: true, data: mappedSuggestions });
    } catch (aiErr: any) {
      if (aiErr.message === 'AI_RATE_LIMIT_EXCEEDED') {
        return c.json({ error: 'Batas kuota penggunaan AI (50 panggilan per jam) telah tercapai.' }, 429);
      }
      return c.json({ error: aiErr.message || 'Gagal merekomendasikan kategori' }, 400);
    }
  } catch (error) {
    console.error('Error in auto-categorization:', error);
    return c.json({ error: 'Gagal memproses kategorisasi otomatis' }, 500);
  }
});
