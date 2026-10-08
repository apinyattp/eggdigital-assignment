import argon2 from 'argon2';
import type { Pool } from 'pg';
export const fixtureIds = {
  member: '10000000-0000-4000-8000-000000000001',
  attendee: '10000000-0000-4000-8000-000000000002',
  candidate: '10000000-0000-4000-8000-000000000003',
  googleOnly: '10000000-0000-4000-8000-000000000004',
  meeting: '20000000-0000-4000-8000-000000000001',
};
export async function seedLoginFixtures(pool: Pool, password: string) {
  if (!password) throw new Error('LOGIN_FIXTURE_PASSWORD missing');
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [id, email, name, credential] of [
      [fixtureIds.member, 'sample01@example.test', 'Sample 01', hash],
      [fixtureIds.attendee, 'sample02@example.test', 'Sample 02', hash],
      [fixtureIds.candidate, 'candidate01@example.test', 'Candidate Test', hash],
      [fixtureIds.googleOnly, 'google-only@example.test', 'Google-only fixture', null],
    ])
      await client.query(
        'INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [id, email, name, credential, '2026-10-07T00:00:00Z'],
      );
    await client.query(
      `INSERT INTO meetings(id,creator_id,create_request_id,title,description,candidate_name,candidate_email,position,starts_at,ends_at,status,format,location,created_at,updated_at)
      VALUES($1,$2,$3,'Candidate denial fixture',NULL,'Candidate Test','candidate01@example.test','Test role','2026-10-08T02:00:00Z','2026-10-08T03:00:00Z','PENDING','ONSITE',NULL,'2026-10-07T00:00:00Z','2026-10-07T00:00:00Z') ON CONFLICT DO NOTHING`,
      [fixtureIds.meeting, fixtureIds.member, '30000000-0000-4000-8000-000000000001'],
    );
    await client.query(
      `INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,'sample02@example.test','Sample 02',$2) ON CONFLICT DO NOTHING`,
      [fixtureIds.meeting, fixtureIds.attendee],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
