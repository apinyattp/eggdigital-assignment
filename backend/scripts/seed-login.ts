import { Pool } from 'pg';
import { requireLocalDatabase } from './local-database.js';
import { seedLoginFixtures } from './fixtures.js';
async function seed() {
  const pool = new Pool({ connectionString: requireLocalDatabase(process.env.DATABASE_URL) });
  try {
    await seedLoginFixtures(pool, process.env.LOGIN_FIXTURE_PASSWORD ?? '');
    process.stdout.write('Isolated local login fixtures ready; existing rows preserved\n');
  } finally {
    await pool.end();
  }
}
seed().catch(() => {
  process.stderr.write(
    'Local fixture setup failed; verify local database and LOGIN_FIXTURE_PASSWORD\n',
  );
  process.exitCode = 1;
});
