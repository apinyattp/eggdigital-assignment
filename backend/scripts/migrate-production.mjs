import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';

// Explicit pre-deploy entry point; never invoked by normal application startup.
try {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) {
    throw new Error('Invalid database configuration');
  }
  await runner({
    databaseUrl,
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    singleTransaction: true,
    noLock: false,
    log: () => {},
    verbose: false,
  });
  process.stdout.write('Production migrations complete\n');
} catch {
  process.stderr.write('Production migration failed; verify database readiness/configuration\n');
  process.exitCode = 1;
}
