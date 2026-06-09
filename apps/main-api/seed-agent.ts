// @ts-nocheck
import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env') });
const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function seedAgent() {
  try {
    const email = 'agent@omnichannel.local';
    const password = 'password123';
    const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });

    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Agent Biasa', ${email}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET password_hash = ${passwordHash}
      RETURNING id, name, email;
    `;

    await sql`
      INSERT INTO account_users (account_id, user_id, role, availability_status)
      VALUES (1, ${user.id}, 'agent', 'online')
      ON CONFLICT (account_id, user_id) DO NOTHING;
    `;

    console.log(`✅ Agent berhasil dibuat! Email: ${email}`);
  } catch (error) {
    console.error('Gagal:', error);
  } finally {
    process.exit(0);
  }
}
seedAgent();