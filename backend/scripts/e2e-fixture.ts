import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';
import { Pool } from 'pg';
import { migrate } from './migrate.js';
import { loadConfig } from '../src/config/env.js';
import { TokenService } from '../src/services/token.service.js';

let phase = 'validate-input';

// This script never accepts SQL or an arbitrary database target from a test.
async function main() {
  const action = process.argv[2];
  if (!['init', 'reset', 'inspect', 'revokeMember', 'expiredAccessToken'].includes(action ?? ''))
    throw new Error('Unknown fixture action');
  const runId = process.env.E2E_RUN_ID ?? '';
  const token = process.env.E2E_RUN_TOKEN ?? '';
  const name = process.env.E2E_OWNED_CONTAINER ?? '';
  const file = process.env.E2E_FIXTURE_PATH ?? '';
  const url = new URL(process.env.E2E_DATABASE_URL ?? '');
  if (
    !/^[0-9a-f-]{36}$/.test(runId) ||
    token.length < 32 ||
    name !== 'eggdigital-e2e-' + runId ||
    !file ||
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/meeting_manager_test' ||
    url.username !== 'meeting_manager' ||
    !url.password ||
    !url.port ||
    url.search ||
    url.hash
  )
    throw new Error('Refusing fixture access outside the owned E2E database');
  phase = 'verify-container-ownership';
  const inspect = (format: string) => {
    const result = spawnSync('docker', ['inspect', '--format', format, name], {
      encoding: 'utf8',
      timeout: 15000,
      killSignal: 'SIGKILL',
    });
    if (result.status !== 0) throw result.error ?? new Error('Owned E2E container unavailable');
    return result.stdout.trim();
  };
  if (inspect('{{ index .Config.Labels "eggdigital.e2e.run" }}') !== runId)
    throw new Error('E2E ownership label mismatch');
  const ports = JSON.parse(inspect('{{json .NetworkSettings.Ports}}'));
  if (
    !ports['5432/tcp']?.some(
      (port: { HostIp: string; HostPort: string }) =>
        port.HostIp === '127.0.0.1' && port.HostPort === url.port,
    )
  )
    throw new Error('E2E database port does not belong to the owned container');

  const pool = new Pool({
    connectionString: url.href,
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  const digest = createHash('sha256').update(token).digest('hex');
  try {
    if (action === 'init') {
      phase = 'host-tcp-readiness';
      // Probe the published host port, not the image's temporary initialization socket.
      const deadline = Date.now() + 30_000;
      for (;;) {
        try {
          await pool.query('SELECT 1');
          break;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (
            Date.now() >= deadline ||
            !['ECONNREFUSED', 'ECONNRESET', '57P03', '57P01'].includes(code ?? '')
          )
            throw error;
          await delay(250);
        }
      }
      phase = 'migrate';
      await migrate(url.href);
      phase = 'create-run-guard';
      await pool.query(
        'CREATE TABLE e2e_run_guard (run_id text PRIMARY KEY, token_digest text NOT NULL)',
      );
      await pool.query('INSERT INTO e2e_run_guard VALUES($1,$2)', [runId, digest]);
    }
    phase = 'verify-run-guard';
    const owned = await pool.query(
      'SELECT 1 FROM e2e_run_guard WHERE run_id=$1 AND token_digest=$2',
      [runId, digest],
    );
    if (owned.rowCount !== 1) throw new Error('E2E run guard mismatch');
    phase = 'read-fixture';
    const fixture = JSON.parse(await readFile(file, 'utf8'));
    if (fixture.runId !== runId) throw new Error('Fixture belongs to another run');
    if (action === 'init' || action === 'reset') {
      phase = 'reset-fixture';
      const hash = await argon2.hash(fixture.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('TRUNCATE users CASCADE');
        const team = Array.from({ length: 55 }, (_, index) => ({
          id: '11000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
          email: `e2e-team-${String(index + 1).padStart(3, '0')}@example.test`,
          displayName: `E2E Team ${String(index + 1).padStart(3, '0')}`,
        }));
        for (const account of [...Object.values(fixture.accounts), ...team] as Array<{
          id: string;
          email: string;
          displayName: string;
        }>) {
          await client.query(
            'INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)',
            [
              account.id,
              account.email,
              account.displayName,
              account.id === fixture.accounts.googleOnly.id ? null : hash,
            ],
          );
        }
        for (const meeting of fixture.seedMeetings) {
          await client.query(
            `INSERT INTO meetings(id,creator_id,create_request_id,title,description,candidate_name,candidate_email,position,starts_at,ends_at,status,format,location,preparation_notes,manual_join_url)
            VALUES($1,$2,$3,$4,'E2E description',$5,$6,'E2E Engineer',$7,$8,$9,$10,$11,'E2E preparation',$12)`,
            [
              meeting.id,
              meeting.creatorId,
              meeting.id,
              meeting.title,
              meeting.candidateName,
              meeting.candidateEmail,
              meeting.startsAt,
              meeting.endsAt,
              meeting.status,
              meeting.format,
              meeting.format === 'ONSITE' ? 'E2E Room' : null,
              meeting.format === 'ONLINE' ? 'https://meet.example.test/e2e-room' : null,
            ],
          );
          if (meeting.creatorId === fixture.accounts.owner.id) {
            await client.query(
              'INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,$2,$3,$4)',
              [
                meeting.id,
                fixture.accounts.attendee.email,
                fixture.accounts.attendee.displayName,
                fixture.accounts.attendee.id,
              ],
            );
          }
        }
        for (const [index, account] of [fixture.accounts.owner, ...team.slice(0, 54)].entries()) {
          if (account.id !== fixture.accounts.owner.id)
            await client.query(
              'INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,$2,$3,$4)',
              [fixture.feedbackMeetingId, account.email, account.displayName, account.id],
            );
          const id = '41000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
          const time = new Date(
            Date.parse(fixture.referenceTime) - (56 - index) * 60000,
          ).toISOString();
          await client.query(
            'INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content,created_at,updated_at) VALUES($1,$2,$3,$4,$1,$5,$6,$6)',
            [
              id,
              fixture.feedbackMeetingId,
              'member:' + account.id,
              account.displayName,
              `Seed feedback ${String(index + 1).padStart(3, '0')}`,
              time,
            ],
          );
        }
        for (const role of ['owner', 'attendee']) {
          await client.query(
            'INSERT INTO interview_notes(meeting_id,author_key,content) VALUES($1,$2,$3)',
            [
              fixture.meetings.onsite.id,
              'member:' + fixture.accounts[role].id,
              `Private ${role} seed note`,
            ],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
      process.stdout.write(JSON.stringify({ ready: true }));
    } else if (action === 'inspect') {
      phase = 'inspect-fixture';
      const meetings = await pool.query(
        'SELECT id,creator_id AS "creatorId",create_request_id AS "requestId",title,status,format,manual_join_url AS "joinUrl",candidate_name AS "candidateName",candidate_email AS "candidateEmail",starts_at AS "startsAt",ends_at AS "endsAt" FROM meetings ORDER BY id',
      );
      const attendees = await pool.query(
        'SELECT meeting_id AS "meetingId",member_id AS "memberId",email FROM meeting_attendees ORDER BY meeting_id,email',
      );
      const notes = await pool.query(
        'SELECT meeting_id AS "meetingId",author_key AS "authorKey",content AS text FROM interview_notes ORDER BY meeting_id,author_key',
      );
      const feedback = await pool.query(
        'SELECT id,meeting_id AS "meetingId",author_key AS "authorKey",create_request_id AS "requestId",content AS text FROM meeting_feedback ORDER BY id',
      );
      process.stdout.write(
        JSON.stringify({
          meetings: meetings.rows,
          attendees: attendees.rows,
          notes: notes.rows,
          feedback: feedback.rows,
        }),
      );
    } else if (action === 'revokeMember') {
      phase = 'revoke-member';
      await pool.query('DELETE FROM users WHERE id=$1', [fixture.accounts.revocable.id]);
      process.stdout.write(JSON.stringify({ revoked: true }));
    } else {
      phase = 'issue-expired-token';
      const config = loadConfig(process.env);
      const tokens = new TokenService(config, () => Date.now() - (config.ttlSeconds + 60) * 1000);
      process.stdout.write(
        JSON.stringify(
          await tokens.issue({ authMethod: 'password', subject: fixture.accounts.owner.id }),
        ),
      );
    }
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  const detail = error as { name?: unknown; code?: unknown; stack?: unknown };
  const name =
    typeof detail?.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(detail.name)
      ? detail.name
      : 'UnknownError';
  const code =
    typeof detail?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(detail.code) ? detail.code : null;
  const line =
    typeof detail?.stack === 'string' ? detail.stack.match(/e2e-fixture\.ts:(\d+):(\d+)/) : null;
  const location = line ? `e2e-fixture.ts:${line[1]}:${line[2]}` : null;
  process.stderr.write(
    'Owned local E2E fixture action failed ' +
      JSON.stringify({ phase, name, code, location }) +
      '; no credentials displayed\n',
  );
  process.exitCode = 1;
});
