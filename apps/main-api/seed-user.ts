import postgres from 'postgres';
import { config } from 'dotenv';
import path from 'path';

// Load .env from apps/main-api
config({ path: path.resolve(process.cwd(), '.env') });

const sql = postgres(process.env.DATABASE_URL || 'postgres://postgres:password_anda@localhost:5432/omnichannel');

async function seedUser() {
  try {
    const email = 'admin@omnichannel.local';
    const password = 'password123';
    
    // Hash password menggunakan fitur bawaan Bun
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    // 1. Buat User
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Administrator', ${email}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET password_hash = ${passwordHash}
      RETURNING id, name, email;
    `;

    // 2. Hubungkan User dengan Account ID = 1
    await sql`
      INSERT INTO account_users (account_id, user_id, role, availability_status)
      VALUES (1, ${user.id}, 'administrator', 'online')
      ON CONFLICT (account_id, user_id) DO NOTHING;
    `;

    console.log(`✅ User berhasil dibuat!`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);

  } catch (error) {
    console.error('Gagal membuat user:', error);
  } finally {
    process.exit(0);
  }
}

seedUser();