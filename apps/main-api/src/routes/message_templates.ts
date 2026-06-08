import { Hono } from 'hono';
import { sql } from '../config/database';
import { jwtMiddleware, getAccountId } from '../middleware/auth';
import { z } from 'zod';

export const messageTemplatesRoutes = new Hono();
messageTemplatesRoutes.use('/*', jwtMiddleware);

// Utility to extract variables
function extractVariables(text: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = [...text.matchAll(regex)];
  const vars = new Set<string>();
  matches.forEach(m => vars.add(m[1].trim()));
  return Array.from(vars);
}

const templateSchema = z.object({
  name: z.string().min(1, 'Nama template tidak boleh kosong'),
  body: z.string().min(1, 'Isi template tidak boleh kosong'),
  category: z.string().optional(),
  language: z.string().optional(),
});

// List templates (with optional search query)
messageTemplatesRoutes.get('/', async (c) => {
  const accountId = getAccountId(c);
  const q = c.req.query('q');

  try {
    let templates;
    if (q) {
      // Full Text Search
      const searchTerms = q.split(' ').map(term => term + ':*').join(' & ');
      templates = await sql`
        SELECT id, name, body, variables, category, language, usage_count, is_active, created_at 
        FROM message_templates
        WHERE account_id = ${accountId} AND is_active = true
        AND to_tsvector('indonesian', name || ' ' || body) @@ to_tsquery('indonesian', ${searchTerms})
        ORDER BY usage_count DESC, created_at DESC
        LIMIT 50
      `;
    } else {
      templates = await sql`
        SELECT id, name, body, variables, category, language, usage_count, is_active, created_at 
        FROM message_templates
        WHERE account_id = ${accountId} AND is_active = true
        ORDER BY usage_count DESC, created_at DESC
        LIMIT 100
      `;
    }
    
    return c.json({ success: true, data: templates });
  } catch (error: any) {
    return c.json({ error: 'Gagal memuat template' }, 500);
  }
});

// Get single template
messageTemplatesRoutes.get('/:id', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const [template] = await sql`
      SELECT * FROM message_templates 
      WHERE id = ${id} AND account_id = ${accountId}
    `;
    if (!template) return c.json({ error: 'Template tidak ditemukan' }, 404);
    
    return c.json({ success: true, data: template });
  } catch (error) {
    return c.json({ error: 'Gagal memuat template' }, 500);
  }
});

// Create template
messageTemplatesRoutes.post('/', async (c) => {
  const accountId = getAccountId(c);
  const userId = (c.get('jwtPayload') as any)?.id;

  try {
    const body = await c.req.json();
    const validated = templateSchema.parse(body);
    const variables = extractVariables(validated.body);

    const [template] = await sql`
      INSERT INTO message_templates (
        account_id, name, body, variables, category, language, created_by
      ) VALUES (
        ${accountId}, ${validated.name}, ${validated.body}, ${variables}, 
        ${validated.category || null}, ${validated.language || 'id'}, ${userId}
      ) RETURNING *
    `;
    
    return c.json({ success: true, data: template });
  } catch (error: any) {
    if (error.code === '23505') return c.json({ error: 'Nama template sudah digunakan' }, 400);
    return c.json({ error: error.message || 'Gagal membuat template' }, 400);
  }
});

// Update template
messageTemplatesRoutes.put('/:id', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const body = await c.req.json();
    const validated = templateSchema.parse(body);
    const variables = extractVariables(validated.body);

    const [template] = await sql`
      UPDATE message_templates SET
        name = ${validated.name},
        body = ${validated.body},
        variables = ${variables},
        category = ${validated.category || null},
        language = ${validated.language || 'id'},
        updated_at = NOW()
      WHERE id = ${id} AND account_id = ${accountId}
      RETURNING *
    `;
    
    if (!template) return c.json({ error: 'Template tidak ditemukan' }, 404);
    return c.json({ success: true, data: template });
  } catch (error: any) {
    if (error.code === '23505') return c.json({ error: 'Nama template sudah digunakan' }, 400);
    return c.json({ error: error.message || 'Gagal mengubah template' }, 400);
  }
});

// Delete template (soft delete)
messageTemplatesRoutes.delete('/:id', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const [template] = await sql`
      UPDATE message_templates SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND account_id = ${accountId}
      RETURNING id
    `;
    
    if (!template) return c.json({ error: 'Template tidak ditemukan' }, 404);
    return c.json({ success: true, data: { id: template.id } });
  } catch (error) {
    return c.json({ error: 'Gagal menghapus template' }, 500);
  }
});

const resolveSchema = z.object({
  conversation_id: z.number().optional(),
  manual_variables: z.record(z.string(), z.string()).optional()
});

// Auto-resolve template
messageTemplatesRoutes.post('/:id/resolve', async (c) => {
  const accountId = getAccountId(c);
  const id = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const validated = resolveSchema.parse(body);

    const [template] = await sql`
      UPDATE message_templates SET usage_count = usage_count + 1 
      WHERE id = ${id} AND account_id = ${accountId} AND is_active = true
      RETURNING *
    `;
    if (!template) return c.json({ error: 'Template tidak ditemukan' }, 404);

    let contactData: Record<string, any> = {};
    if (validated.conversation_id) {
      const [contact] = await sql`
        SELECT con.* 
        FROM conversations c
        JOIN contacts con ON c.contact_id = con.id
        WHERE c.id = ${validated.conversation_id} AND c.account_id = ${accountId}
      `;
      if (contact) {
        contactData = {
          name: contact.name || '',
          email: contact.email || '',
          phone: contact.phone_number || ''
        };
      }
    }

    const allVars = { ...contactData, ...validated.manual_variables };
    let resolvedBody = template.body;

    template.variables.forEach((variable: string) => {
      // For variable resolution, support nested properties or just exact match
      // First exact match (ignoring case)
      let val = '';
      const lowerVar = variable.toLowerCase();
      
      if (allVars[variable] !== undefined) val = allVars[variable];
      else if (allVars[lowerVar] !== undefined) val = allVars[lowerVar];
      else if (lowerVar === 'contact.name' || lowerVar === 'customer.name') val = contactData.name || '';
      else if (lowerVar === 'contact.email' || lowerVar === 'customer.email') val = contactData.email || '';
      else if (lowerVar === 'contact.phone' || lowerVar === 'customer.phone') val = contactData.phone || '';

      const regex = new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`, 'g');
      resolvedBody = resolvedBody.replace(regex, val || '');
    });

    return c.json({ 
      success: true, 
      data: {
        resolved_body: resolvedBody,
        original_template: template
      } 
    });
  } catch (error: any) {
    return c.json({ error: error.message || 'Gagal meresolve template' }, 400);
  }
});
