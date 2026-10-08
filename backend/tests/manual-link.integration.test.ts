import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import request from 'supertest';
import { requireLocalDatabase } from '../scripts/local-database.js';
import { migrate } from '../scripts/migrate.js';
import { seedLoginFixtures, fixtureIds } from '../scripts/fixtures.js';
import { config, password } from './support.js';
import { createApp } from '../src/app.js';
import { AuthModel } from '../src/models/auth.model.js';
import { AuthService } from '../src/services/auth.service.js';
import { TokenService } from '../src/services/token.service.js';
import { MemberModel } from '../src/models/member.model.js';
import { MemberService } from '../src/services/member.service.js';
import { MeetingModel } from '../src/models/meeting.model.js';
import { MeetingService } from '../src/services/meeting.service.js';

const databaseUrl = requireLocalDatabase(process.env.TEST_DATABASE_URL, true);
const pool = new Pool({ connectionString: databaseUrl, max: 6 });
const tokens = new TokenService(config);
const provider = {
  checkAvailable() {},
  authorizationUrl() {
    return '';
  },
  async exchange() {
    throw new Error('No provider calls');
  },
  async verifyIdToken() {
    throw new Error('No provider calls');
  },
};
const authModel = new AuthModel(pool);
const model = new MeetingModel(pool);
let currentTime = '2026-10-08T03:00:00.000Z';
const service = new MeetingService(model, () => new Date(currentTime));
const app = createApp(
  config,
  new AuthService(authModel, tokens, provider, 'unused'),
  provider,
  authModel,
  new MemberService(new MemberModel(pool)),
  service,
);
const owner = fixtureIds.member,
  attendee = fixtureIds.attendee;
const draft = () => ({
  requestId: randomUUID(),
  title: 'Meeting',
  description: 'General details',
  preparationNotes: 'Bring portfolio',
  candidateName: 'Candidate',
  candidateEmail: 'new-candidate@example.test',
  position: 'Engineer',
  startsAt: '2026-10-08T09:00:00+07:00',
  endsAt: '2026-10-08T11:00:00+07:00',
  attendeeMemberIds: [attendee],
});
async function access(id = owner) {
  return 'mm_access=' + (await tokens.issue({ authMethod: 'password', subject: id })).token;
}
async function post(path: string, body: unknown, id = owner) {
  return request(app)
    .post('/api/v1/meetings' + path)
    .set('Cookie', await access(id))
    .set('Origin', config.allowedOrigin)
    .set('X-Requested-With', 'MeetingManager')
    .send(body);
}
async function get(path: string, id = owner) {
  if (path.startsWith('?')) {
    const query = new URLSearchParams(path.slice(1));
    if (!query.has('page')) query.set('page', '1');
    if (!query.has('pageSize')) query.set('pageSize', '10');
    path = '?' + query;
  }
  return request(app)
    .get('/api/v1/meetings' + path)
    .set('Cookie', await access(id));
}
async function create() {
  const result = await post('', draft());
  expect(result.status).toBe(201);
  return result.body.meeting;
}
beforeAll(async () => {
  await migrate(databaseUrl);
});
beforeEach(async () => {
  currentTime = '2026-10-08T03:00:00.000Z';
  await pool.query(
    'TRUNCATE meeting_provider_cleanup,meeting_calendar_links,meeting_provider_operations,provider_connections,interview_notes,meeting_feedback,deleted_meeting_requests,meeting_attendees,meetings,users',
  );
  await seedLoginFixtures(pool, password);
});
afterAll(async () => {
  await pool.end();
});

describe('Manual Online fallback without external provider calls', () => {
  it('applies the exact additive migration to legacy rows without changing original values', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'CREATE TEMP TABLE meetings (LIKE public.meetings INCLUDING ALL) ON COMMIT DROP',
      );
      await client.query('ALTER TABLE pg_temp.meetings DROP COLUMN manual_join_url');
      await client.query(
        `ALTER TABLE pg_temp.meetings ADD CONSTRAINT meetings_online_provider_check CHECK(format<>'ONLINE' OR (meeting_provider IS NOT NULL AND external_meeting_id IS NOT NULL))`,
      );
      await client.query(
        `INSERT INTO pg_temp.meetings(id,creator_id,create_request_id,title,candidate_name,candidate_email,position,starts_at,ends_at,format,meeting_provider,external_meeting_id) VALUES($1,$2,$3,'Legacy row','Candidate','legacy@example.test','Engineer','2026-10-09T02:00Z','2026-10-09T03:00Z','ONLINE','GOOGLE_MEET','preserved-event')`,
        [randomUUID(), owner, randomUUID()],
      );
      const before = (await client.query('SELECT to_jsonb(m) AS row FROM pg_temp.meetings m')).rows;
      const statements: string[] = [];
      createRequire(import.meta.url)('../migrations/1791420900000_manual-meeting-link.cjs').up({
        sql: (sql: string) => statements.push(sql),
      });
      for (const sql of statements) await client.query(sql);
      const after = (
        await client.query("SELECT to_jsonb(m)-'manual_join_url' AS row FROM pg_temp.meetings m")
      ).rows;
      expect(after).toEqual(before);
      expect(
        (await client.query('SELECT manual_join_url FROM pg_temp.meetings')).rows[0]
          .manual_join_url,
      ).toBeNull();
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('creates, replays and edits the manual link while preserving schedule and permissions', async () => {
    const body = { ...draft(), format: 'ONLINE', joinUrl: 'https://meet.google.com/abc-defg-hij' };
    const created = await post('', body);
    expect(created.status).toBe(201);
    const m = created.body.meeting;
    expect(m).toMatchObject({
      joinUrl: body.joinUrl,
      format: 'ONLINE',
      meetingProvider: null,
      externalMeetingId: null,
    });
    expect((await post('', body)).body.meeting.id).toBe(m.id);
    const denied = await post(
      '/' + m.id + '/edit',
      { expectedUpdatedAt: m.updatedAt, joinUrl: 'https://example.test/room' },
      attendee,
    );
    expect(denied.status).toBe(404);
    const edited = await post('/' + m.id + '/edit', {
      expectedUpdatedAt: m.updatedAt,
      joinUrl: 'https://example.test/room',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.meeting).toMatchObject({
      joinUrl: 'https://example.test/room',
      startsAt: m.startsAt,
      endsAt: m.endsAt,
    });
    expect(
      (await post('/' + m.id + '/edit', { expectedUpdatedAt: m.updatedAt, joinUrl: body.joinUrl }))
        .status,
    ).toBe(409);
    expect(
      (
        await post('/' + m.id + '/edit', {
          expectedUpdatedAt: edited.body.meeting.updatedAt,
          startsAt: m.startsAt,
        })
      ).status,
    ).toBe(400);
    expect(
      (await pool.query('SELECT count(*)::int n FROM meeting_provider_operations')).rows[0].n,
    ).toBe(0);
    expect((await pool.query('SELECT count(*)::int n FROM meeting_calendar_links')).rows[0].n).toBe(
      0,
    );
  });
  it.each(['', 'javascript:alert(1)', 'http://example.test/room'])(
    'rejects unsafe/empty link %s',
    async (joinUrl) => {
      expect((await post('', { ...draft(), format: 'ONLINE', joinUrl })).status).toBe(400);
    },
  );
  it('retains old external identifiers when updating a historical Online meeting locally', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO meetings(id,creator_id,create_request_id,title,candidate_name,candidate_email,position,starts_at,ends_at,format,meeting_provider,external_meeting_id) VALUES($1,$2,$3,'Historical','Candidate','legacy@example.test','Engineer','2026-10-09T02:00Z','2026-10-09T03:00Z','ONLINE','GOOGLE_MEET','retained-external-id')`,
      [id, owner, randomUUID()],
    );
    const connectionId = randomUUID();
    await pool.query(
      `INSERT INTO provider_connections(id,creator_id,provider,provider_subject,granted_scopes,credentials_ciphertext,nonce,authentication_tag,key_version,access_expires_at,status) VALUES($1,$2,'GOOGLE_CALENDAR','historical-subject','{}',decode('00','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),'historical','2026-01-01','reconnect_required')`,
      [connectionId, owner],
    );
    await pool.query(
      `INSERT INTO meeting_provider_operations(creator_id,request_id,operation_id,provider,google_connection_id,phase,external_meeting_id,join_url,calendar_id,calendar_event_id,meeting_id) SELECT creator_id,create_request_id,$2,'GOOGLE_MEET',$3,'COMPLETED',external_meeting_id,'https://meet.google.com/abc-defg-hij','primary','historical-event',id FROM meetings WHERE id=$1`,
      [id, randomUUID(), connectionId],
    );
    await pool.query(
      `INSERT INTO meeting_calendar_links(meeting_id,connection_id,calendar_id,event_id) VALUES($1,$2,'primary','historical-event')`,
      [id, connectionId],
    );
    const historyBefore = (
      await pool.query(
        'SELECT to_jsonb(l) AS data FROM meeting_calendar_links l WHERE meeting_id=$1',
        [id],
      )
    ).rows;
    const current = (await get('/' + id)).body.meeting;
    expect(current.joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    const changed = await post('/' + id + '/edit', {
      expectedUpdatedAt: current.updatedAt,
      title: 'Local change',
      joinUrl: 'https://example.test/manual',
    });
    expect(
      (
        await pool.query(
          'SELECT to_jsonb(l) AS data FROM meeting_calendar_links l WHERE meeting_id=$1',
          [id],
        )
      ).rows,
    ).toEqual(historyBefore);
    expect(
      (
        await pool.query(
          'SELECT external_meeting_id FROM meeting_provider_operations WHERE meeting_id=$1',
          [id],
        )
      ).rows[0].external_meeting_id,
    ).toBe('retained-external-id');
    expect(changed.status).toBe(200);
    expect(changed.body.meeting).toMatchObject({
      externalMeetingId: 'retained-external-id',
      meetingProvider: 'GOOGLE_MEET',
      joinUrl: 'https://example.test/manual',
    });
    expect(
      (
        await pool.query(
          'SELECT to_jsonb(l) AS data FROM meeting_calendar_links l WHERE meeting_id=$1',
          [id],
        )
      ).rows,
    ).toEqual(historyBefore);
    expect(
      (
        await pool.query(
          'SELECT external_meeting_id FROM meeting_provider_operations WHERE meeting_id=$1',
          [id],
        )
      ).rows[0].external_meeting_id,
    ).toBe('retained-external-id');
  });
  it('cancels and deletes a manual Online meeting with local responses and no cleanup receipt', async () => {
    const first = await post('', {
      ...draft(),
      format: 'ONLINE',
      joinUrl: 'https://example.test/room',
    });
    expect(first.status).toBe(201);
    const m = first.body.meeting;
    const cancelled = await post('/' + m.id + '/cancel', { expectedUpdatedAt: m.updatedAt });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.meeting).toMatchObject({ status: 'CANCELLED', joinUrl: null });
    expect(cancelled.body).not.toHaveProperty('providerCleanup');
    const deleted = await post('/' + m.id + '/delete', {
      expectedUpdatedAt: cancelled.body.meeting.updatedAt,
    });
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');
    expect(
      (await pool.query('SELECT count(*)::int n FROM meeting_provider_cleanup')).rows[0].n,
    ).toBe(0);
  });
  it('keeps Onsite behavior and disallows adding a link to Onsite', async () => {
    const m = await create();
    expect(
      (
        await post('/' + m.id + '/edit', {
          expectedUpdatedAt: m.updatedAt,
          joinUrl: 'https://example.test/room',
        })
      ).status,
    ).toBe(400);
    expect((await get('/' + m.id)).body.meeting.format).toBe('ONSITE');
  });
});
