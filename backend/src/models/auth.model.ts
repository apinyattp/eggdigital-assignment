import type { Pool } from 'pg';
import { unavailable } from '../utils/api-error.js';
export type Member = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
};
export type PrincipalLookup = {
  member: Pick<Member, 'id' | 'email' | 'display_name'> | null;
  candidateDenied: boolean;
};
export class AuthModel {
  constructor(private pool: Pool) {}
  async findByEmail(email: string): Promise<Member | null> {
    try {
      return (
        (
          await this.pool.query<Member>(
            'SELECT id,email,display_name,password_hash FROM users WHERE email = $1',
            [email],
          )
        ).rows[0] ?? null
      );
    } catch {
      throw unavailable();
    }
  }
  async findPrincipal(column: 'id' | 'email', value: string): Promise<PrincipalLookup> {
    try {
      // Keep a row for a Google candidate whose email has no registered member.
      const { rows } = await this.pool.query<{
        id: string | null;
        email: string | null;
        display_name: string | null;
        denied: boolean;
      }>(
        `SELECT member.id,member.email,member.display_name,
          EXISTS (SELECT 1 FROM meetings
            WHERE candidate_email = ${column === 'id' ? 'member.email' : '$1'}) AS denied
         FROM (SELECT 1) AS principal
         LEFT JOIN users AS member ON member.${column} = $1`,
        [value],
      );
      const row = rows[0]!;
      return {
        member:
          row.id === null
            ? null
            : {
                id: row.id,
                email: row.email!,
                display_name: row.display_name!,
              },
        candidateDenied: row.denied,
      };
    } catch {
      throw unavailable();
    }
  }
  async checkReady(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw unavailable();
    }
  }
}
