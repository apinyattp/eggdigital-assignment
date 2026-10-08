import type { Pool } from 'pg';
import { unavailable } from '../utils/api-error.js';
export type Member = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
};
export class AuthModel {
  constructor(private pool: Pool) {}
  async findByEmail(email: string): Promise<Member | null> {
    return this.find('email', email);
  }
  async findById(id: string): Promise<Member | null> {
    return this.find('id', id);
  }
  private async find(column: 'id' | 'email', value: string): Promise<Member | null> {
    try {
      return (
        (
          await this.pool.query<Member>(
            `SELECT id,email,display_name,password_hash FROM users WHERE ${column} = $1`,
            [value],
          )
        ).rows[0] ?? null
      );
    } catch {
      throw unavailable();
    }
  }
  async checkCandidate(email: string): Promise<boolean> {
    try {
      return (
        await this.pool.query<{ denied: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM meetings WHERE candidate_email = $1) AS denied',
          [email],
        )
      ).rows[0]!.denied;
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
