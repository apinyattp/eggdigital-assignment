import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import { requireLocalDatabase } from './local-database.js';
export async function migrate(databaseUrl: string) {
  await runner({
    databaseUrl: requireLocalDatabase(databaseUrl),
    dir: fileURLToPath(new URL('../migrations', import.meta.url)),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
    verbose: false,
  });
}
if (import.meta.url === new URL(process.argv[1]!, 'file:').href) {
  migrate(requireLocalDatabase(process.env.DATABASE_URL))
    .then(() => process.stdout.write('Local migrations complete\n'))
    .catch(() => {
      process.stderr.write('Local migration failed; verify database readiness/configuration\n');
      process.exitCode = 1;
    });
}
