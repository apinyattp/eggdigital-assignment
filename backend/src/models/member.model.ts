import type { Pool, PoolClient } from 'pg';
import { unavailable } from '../utils/api-error.js';
export type MemberView = { id: string; displayName: string; email: string };
export class MemberModel {
  constructor(private pool: Pool) {}
  async countMembers(client: PoolClient, pattern: string): Promise<number> {
    const result = await client.query<{ total: string }>(
      `SELECT count(*) AS total FROM users WHERE display_name ILIKE $1 OR email ILIKE $1`,
      [pattern],
    );
    return Number(result.rows[0]!.total);
  }
  async findMembers(
    client: PoolClient,
    pattern: string,
    pageSize: number,
    offset: number,
  ): Promise<MemberView[]> {
    return (
      await client.query<MemberView>(
        `SELECT id, display_name AS "displayName", email FROM users
       WHERE display_name ILIKE $1 OR email ILIKE $1
       ORDER BY email, id LIMIT $2 OFFSET $3`,
        [pattern, pageSize, offset],
      )
    ).rows;
  }
  async readPage(query: string, pageSize: number, offset: number) {
    const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const total = await this.countMembers(client, pattern);
      const items = await this.findMembers(client, pattern, pageSize, offset);
      await client.query('COMMIT');
      return { items, total };
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
}
