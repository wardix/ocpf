import { readFileSync } from 'fs';
import path from 'path';

// Load env variables from main-api/.env if DATABASE_URL is not set
if (!process.env.DATABASE_URL) {
  try {
    const envPath = path.resolve(__dirname, '../../main-api/.env');
    const envFile = readFileSync(envPath, 'utf8');
    for (const line of envFile.split('\n')) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key && !key.startsWith('#')) {
          process.env[key] = value;
        }
      }
    }
  } catch (e) {
    // Ignore error
  }
}

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
const { sql } = require('./database');
const { usePostgresAuthState } = require('./postgres-auth-state');

describe('PostgresAuthState Adapter Tests', () => {
  let testAccountId: number;
  let testChannelId: number;
  let testInboxId: number;

  beforeAll(async () => {
    // Reset sequences
    await sql`SELECT setval('accounts_id_seq', COALESCE((SELECT MAX(id) FROM accounts), 1), true)`;
    await sql`SELECT setval('channels_id_seq', COALESCE((SELECT MAX(id) FROM channels), 1), true)`;
    await sql`SELECT setval('inboxes_id_seq', COALESCE((SELECT MAX(id) FROM inboxes), 1), true)`;

    // 1. Create a test account, channel, and inbox
    const [account] = await sql`
      INSERT INTO accounts (name)
      VALUES ('Auth State Test Account')
      RETURNING id
    `;
    testAccountId = Number(account.id);

    const [channel] = await sql`
      INSERT INTO channels (account_id, name, provider_type, provider_config)
      VALUES (${testAccountId}, 'Auth State Test Channel', 'whatsapp', '{}'::jsonb)
      RETURNING id
    `;
    testChannelId = Number(channel.id);

    const [inbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'Auth State Test Inbox')
      RETURNING id
    `;
    testInboxId = Number(inbox.id);
  });

  afterAll(async () => {
    // Clean up
    if (testAccountId) {
      // whatsapp_auth_states is ON DELETE CASCADE via inbox, so deleting account will cascade delete everything
      await sql`DELETE FROM accounts WHERE id = ${testAccountId}`;
    }
  });

  it('should read and write basic credentials (creds.json)', async () => {
    const { state, saveCreds } = await usePostgresAuthState(sql, testInboxId);

    // Modify creds
    state.creds.me = { id: '62812345678@s.whatsapp.net', name: 'Test User' };
    state.creds.pairingEphemeralKeyPair = {
      private: Buffer.from('private-key-data'),
      public: Buffer.from('public-key-data'),
    };

    await saveCreds();

    // Reinitialize state to check if it parses correctly from the database
    const { state: newState } = await usePostgresAuthState(sql, testInboxId);
    expect(newState.creds.me).toEqual(state.creds.me);
    expect(newState.creds.pairingEphemeralKeyPair.private).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(newState.creds.pairingEphemeralKeyPair.private).toString()).toBe('private-key-data');
  });

  it('should support batch get and set keys', async () => {
    const { state } = await usePostgresAuthState(sql, testInboxId);

    const testKeys = {
      'pre-key': {
        '1': {
          private: Buffer.from('pre-key-private-1'),
          public: Buffer.from('pre-key-public-1'),
        },
        '2': {
          private: Buffer.from('pre-key-private-2'),
          public: Buffer.from('pre-key-public-2'),
        },
      },
      'session': {
        'session-id-abc': Buffer.from('session-data-content'),
      },
    };

    // Save keys
    await state.keys.set(testKeys);

    // Retrieve keys
    const fetchedPreKeys = await state.keys.get('pre-key', ['1', '2', '3']);
    expect(fetchedPreKeys['1']).toBeDefined();
    expect(Buffer.from(fetchedPreKeys['1'].private).toString()).toBe('pre-key-private-1');
    expect(fetchedPreKeys['2']).toBeDefined();
    expect(Buffer.from(fetchedPreKeys['2'].private).toString()).toBe('pre-key-private-2');
    expect(fetchedPreKeys['3']).toBeNull();

    const fetchedSessions = await state.keys.get('session', ['session-id-abc']);
    expect(fetchedSessions['session-id-abc']).toBeDefined();
    expect(Buffer.from(fetchedSessions['session-id-abc']).toString()).toBe('session-data-content');
  });

  it('should delete keys when value is null or empty', async () => {
    const { state } = await usePostgresAuthState(sql, testInboxId);

    // Save a key first
    await state.keys.set({
      'pre-key': {
        '10': { data: 'some-data' },
      },
    });

    // Check it exists
    let keys = await state.keys.get('pre-key', ['10']);
    expect(keys['10']).toEqual({ data: 'some-data' });

    // Delete it by setting to null
    await state.keys.set({
      'pre-key': {
        '10': null,
      },
    });

    // Check it is gone
    keys = await state.keys.get('pre-key', ['10']);
    expect(keys['10']).toBeNull();
  });

  it('should isolate states by inbox_id', async () => {
    // 1. Create another inbox for the same account
    const [anotherInbox] = await sql`
      INSERT INTO inboxes (account_id, channel_id, name)
      VALUES (${testAccountId}, ${testChannelId}, 'Another Test Inbox')
      RETURNING id
    `;
    const anotherInboxId = Number(anotherInbox.id);

    try {
      const adapter1 = await usePostgresAuthState(sql, testInboxId);
      const adapter2 = await usePostgresAuthState(sql, anotherInboxId);

      // Write key to inbox 1
      await adapter1.state.keys.set({
        'session': {
          'shared-key': Buffer.from('inbox-1-secret'),
        },
      });

      // Write key to inbox 2 with different content
      await adapter2.state.keys.set({
        'session': {
          'shared-key': Buffer.from('inbox-2-secret'),
        },
      });

      // Verify they do not conflict and are isolated
      const res1 = await adapter1.state.keys.get('session', ['shared-key']);
      const res2 = await adapter2.state.keys.get('session', ['shared-key']);

      expect(Buffer.from(res1['shared-key']).toString()).toBe('inbox-1-secret');
      expect(Buffer.from(res2['shared-key']).toString()).toBe('inbox-2-secret');
    } finally {
      // Cleanup the second inbox
      await sql`DELETE FROM inboxes WHERE id = ${anotherInboxId}`;
    }
  });

  it('should handle app-state-sync-key format correctly', async () => {
    const { state } = await usePostgresAuthState(sql, testInboxId);

    const syncKeyData = {
      keyData: Buffer.from('key-data-bytes'),
      fingerprint: {
        rawId: 12345,
        currentIndex: 1,
        deviceIndexes: [1],
      },
    };

    await state.keys.set({
      'app-state-sync-key': {
        'sync-key-1': syncKeyData,
      },
    });

    const fetched = await state.keys.get('app-state-sync-key', ['sync-key-1']);
    expect(fetched['sync-key-1']).toBeDefined();
    expect(fetched['sync-key-1'].keyData).toBeInstanceOf(Uint8Array);
  });
});
