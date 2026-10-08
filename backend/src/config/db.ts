import { Pool } from 'pg';
import type { Config } from './env.js';
export function createPool(config: Config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000,
  });
  pool.on('error', () => {
    process.stderr.write('Database connection unavailable\n');
  });
  return pool;
}
