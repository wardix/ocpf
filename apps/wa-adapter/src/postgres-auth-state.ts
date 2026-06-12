import { proto } from '@whiskeysockets/baileys';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import type { AuthenticationState } from '@whiskeysockets/baileys';
import postgres from 'postgres';

export const usePostgresAuthState = async (
  sql: postgres.Sql,
  inboxId: number
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {
  const writeData = async (data: any, file: string) => {
    const valueStr = JSON.stringify(data, BufferJSON.replacer);
    await sql`
      INSERT INTO whatsapp_auth_states (inbox_id, key, value)
      VALUES (${inboxId}, ${file}, ${valueStr}::text::jsonb)
      ON CONFLICT (inbox_id, key)
      DO UPDATE SET value = EXCLUDED.value
    `;
  };

  const readData = async (file: string) => {
    const [row] = await sql`
      SELECT value::text FROM whatsapp_auth_states
      WHERE inbox_id = ${inboxId} AND key = ${file}
      LIMIT 1
    `;
    if (row && row.value) {
      return JSON.parse(row.value, BufferJSON.reviver);
    }
    return null;
  };

  const creds = (await readData('creds.json')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          const files = ids.map((id) => `${type}-${id}.json`);

          const rows = await sql`
            SELECT key, value::text FROM whatsapp_auth_states
            WHERE inbox_id = ${inboxId} AND key = ANY(${files})
          `;

          const rowMap = new Map(rows.map((r) => [r.key, r.value]));

          for (const id of ids) {
            const file = `${type}-${id}.json`;
            const jsonText = rowMap.get(file);
            let value = jsonText ? JSON.parse(jsonText, BufferJSON.reviver) : null;
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data: any) => {
          const upserts: { key: string; value: string }[] = [];
          const deletes: string[] = [];

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              if (value) {
                upserts.push({
                  key: file,
                  value: JSON.stringify(value, BufferJSON.replacer),
                });
              } else {
                deletes.push(file);
              }
            }
          }

          await sql.begin(async (tx) => {
            if (upserts.length > 0) {
              for (const item of upserts) {
                await tx`
                  INSERT INTO whatsapp_auth_states (inbox_id, key, value)
                  VALUES (${inboxId}, ${item.key}, ${item.value}::text::jsonb)
                  ON CONFLICT (inbox_id, key)
                  DO UPDATE SET value = EXCLUDED.value
                `;
              }
            }

            if (deletes.length > 0) {
              await tx`
                DELETE FROM whatsapp_auth_states
                WHERE inbox_id = ${inboxId} AND key = ANY(${deletes})
              `;
            }
          });
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds.json');
    },
  };
};
