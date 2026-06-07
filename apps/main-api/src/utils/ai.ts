import { sql } from '../config/database';
import { redis } from '../config/redis';
import { decrypt } from './crypto';

export interface AISuggestion {
  label: string;
  confidence: number;
}

export interface AISummary {
  summary: string;
  key_points: string[];
}

export async function callAI(
  accountId: number,
  userId: number | null,
  feature: 'smart_reply' | 'summarize' | 'auto_categorize',
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  const startTime = Date.now();

  // 1. Fetch active AI config
  const [config] = await sql`
    SELECT * FROM ai_configs
    WHERE account_id = ${accountId} AND is_active = true LIMIT 1
  `;
  if (!config) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  // 2. Check if feature is enabled
  const features = config.features_enabled || [];
  if (!features.includes(feature)) {
    throw new Error('AI_FEATURE_DISABLED');
  }

  // 3. Enforce rate limiting: 50 calls per hour per account
  const hourlyKey = `ai_limit:${accountId}:${new Date().getUTCHours()}`;
  const calls = await redis.incr(hourlyKey);
  if (calls === 1) {
    await redis.expire(hourlyKey, 3600); // 1 hour TTL
  }
  if (calls > 50) {
    throw new Error('AI_RATE_LIMIT_EXCEEDED');
  }

  // 4. Decrypt API Key
  const apiKey = decrypt(config.api_key_encrypted);
  const provider = config.provider.toLowerCase();
  const model = config.model;
  const maxTokens = config.max_tokens || 500;
  const temp = config.temperature ? Number(config.temperature) : 0.7;

  let responseText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: temp
      })
    });

    if (!res.ok) {
      const errorData = await res.text();
      throw new Error(`OpenAI API Error: ${errorData}`);
    }

    const data = await res.json();
    responseText = data.choices?.[0]?.message?.content || '';
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;

  } else if (provider === 'gemini') {
    const modelName = model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const body: any = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: temp
      }
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorData = await res.text();
      throw new Error(`Gemini API Error: ${errorData}`);
    }

    const data = await res.json();
    responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    inputTokens = data.usageMetadata?.promptTokenCount || 0;
    outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

  } else {
    throw new Error('INVALID_AI_PROVIDER');
  }

  const latency = Date.now() - startTime;

  // 5. Log token usage to database
  try {
    await sql`
      INSERT INTO ai_usage_logs (account_id, user_id, feature, tokens_input, tokens_output, latency_ms)
      VALUES (${accountId}, ${userId}, ${feature}, ${inputTokens}, ${outputTokens}, ${latency})
    `;
  } catch (err) {
    console.error('Failed to log AI usage:', err);
  }

  return responseText;
}

// Clean markdown tags from JSON response blocks if LLM outputted them
export function parseJSONResponse(text: string): any {
  let cleanText = text.trim();
  // Strip Markdown JSON block markers if present
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.substring(7);
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  return JSON.parse(cleanText.trim());
}
