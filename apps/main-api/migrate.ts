import { runner } from 'node-pg-migrate';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL || 'postgres://omni:3aa53cec161c587e51555bdfa5c56eff@localhost:5432/omni';

async function run() {
  const args = process.argv.slice(2);
  const direction = (args.includes('down') ? 'down' : 'up') as 'up' | 'down';
  const fake = args.includes('--fake');
  
  console.log(`Running database migrations (${direction})${fake ? ' [FAKE]' : ''}...`);
  
  try {
    await runner({
      databaseUrl,
      dir: path.resolve(__dirname, 'migrations'),
      direction,
      migrationsTable: 'pgmigrations',
      fake,
      verbose: true,
    });
    console.log('Database migrations completed successfully!');
  } catch (error) {
    console.error('Database migrations failed:', error);
    process.exit(1);
  }
}

run();
