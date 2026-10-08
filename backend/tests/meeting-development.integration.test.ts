import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
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
  authModel,
  new MemberService(new MemberModel(pool)),
  service,
);
const owner = fixtureIds.member,
  attendee = fixtureIds.attendee;
const ownerUser = {
  id: owner,
  membership: 'member' as const,
  email: 'sample01@example.test',
  displayName: 'Sample 01',
};
const teamUser = {
  id: attendee,
  membership: 'member' as const,
  email: 'sample02@example.test',
  displayName: 'Sample 02',
};
const guestUser = {
  email: 'external@gmail.com',
  displayName: 'Guest',
};
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

describe('Confirmed Add amendment in real PostgreSQL', () => {
  it('stores two independent fields, permits earlier today and cross-day, preserves replay after time passes', async () => {
    const body = { ...draft(), endsAt: '2026-10-10T00:00:00.000001+07:00' };
    const first = await post('', body);
    expect(first.status).toBe(201);
    expect(first.body.meeting).toMatchObject({
      description: body.description,
      preparationNotes: body.preparationNotes,
      endsAt: '2026-10-09T17:00:00.000001Z',
    });
    currentTime = '2030-01-01T00:00:00Z';
    const replay = await post('', { ...body, description: 'wrong', preparationNotes: 'wrong' });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect((await get('/' + first.body.meeting.id)).body).toEqual(first.body);
  });
  it.each([
    ['2026-10-07T23:59:59+07:00', '2026-10-08T11:00:00+07:00'],
    ['2026-10-08T09:00:00+07:00', '2026-10-08T10:00:00+07:00'],
    ['2026-10-09T11:00:00+07:00', '2026-10-09T10:00:00+07:00'],
  ])(
    'rejects invalid new temporal operation without storing a key %s',
    async (startsAt, endsAt) => {
      const body = { ...draft(), startsAt, endsAt };
      expect((await post('', body)).status).toBe(400);
      expect(
        (await pool.query('SELECT id FROM meetings WHERE create_request_id=$1', [body.requestId]))
          .rows,
      ).toHaveLength(0);
    },
  );
  it('additive migration preserves old description without guessing preparation', async () => {
    expect(
      (
        await pool.query('SELECT description,preparation_notes FROM meetings WHERE id=$1', [
          fixtureIds.meeting,
        ])
      ).rows[0],
    ).toMatchObject({ preparation_notes: null });
  });
});

describe('Batched attendee persistence in real PostgreSQL', () => {
  const addedMembers = [
    {
      id: '10000000-0000-4000-8000-000000000010',
      email: 'zeta@example.test',
      displayName: 'สมาชิก, "Zeta"',
    },
    {
      id: '10000000-0000-4000-8000-000000000011',
      email: 'alpha@example.test',
      displayName: 'Alpha\nSnapshot',
    },
  ];
  async function seedAddedMembers() {
    for (const member of addedMembers) {
      await pool.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)', [
        member.id,
        member.email,
        member.displayName,
      ]);
    }
  }
  it.each(['create', 'edit'] as const)(
    '%s preserves member snapshots, response order, and idempotent retries for multiple additions',
    async (operation) => {
      await seedAddedMembers();
      const existing = operation === 'edit' ? await create() : null;
      const selected = [addedMembers[1].id, attendee, addedMembers[0].id];
      const body =
        operation === 'create'
          ? { ...draft(), attendeeMemberIds: selected }
          : {
              expectedUpdatedAt: existing.updatedAt,
              attendeeChanges: { addMemberIds: selected, removeEmails: [] },
            };
      const path = existing ? '/' + existing.id + '/edit' : '';
      const result = await post(path, body);
      expect(result.status).toBe(operation === 'create' ? 201 : 200);
      const expected = [
        {
          memberId: addedMembers[1].id,
          email: addedMembers[1].email,
          displayName: addedMembers[1].displayName,
        },
        { memberId: attendee, email: teamUser.email, displayName: teamUser.displayName },
        {
          memberId: addedMembers[0].id,
          email: addedMembers[0].email,
          displayName: addedMembers[0].displayName,
        },
      ];
      expect(result.body.meeting.attendees).toEqual(expected);
      expect(
        (
          await pool.query(
            'SELECT member_id AS "memberId",email,display_name AS "displayName" FROM meeting_attendees WHERE meeting_id=$1 ORDER BY email,member_id',
            [result.body.meeting.id],
          )
        ).rows,
      ).toEqual(expected);
      await pool.query("UPDATE users SET display_name='Changed later' WHERE id=ANY($1::uuid[])", [
        selected,
      ]);
      const replay = await post(
        path,
        operation === 'edit' ? { ...body, expectedUpdatedAt: result.body.meeting.updatedAt } : body,
      );
      expect(replay.status).toBe(200);
      expect(replay.body.meeting).toEqual(result.body.meeting);
    },
  );
  it.each(['create', 'edit'] as const)(
    '%s rolls back the entire batch and other writes when an attendee insert fails',
    async (operation) => {
      await seedAddedMembers();
      const existing = operation === 'edit' ? await create() : null;
      const body =
        operation === 'create'
          ? { ...draft(), attendeeMemberIds: addedMembers.map((member) => member.id) }
          : {
              expectedUpdatedAt: existing.updatedAt,
              title: 'Must rollback',
              attendeeChanges: {
                addMemberIds: addedMembers.map((member) => member.id),
                removeEmails: [teamUser.email],
              },
            };
      const path = existing ? '/' + existing.id + '/edit' : '';
      await pool.query(
        "CREATE FUNCTION fail_batch_attendee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email='alpha@example.test' THEN RAISE EXCEPTION 'injected batch failure'; END IF; RETURN NEW; END $$",
      );
      await pool.query(
        'CREATE TRIGGER fail_batch_attendee BEFORE INSERT ON meeting_attendees FOR EACH ROW EXECUTE FUNCTION fail_batch_attendee()',
      );
      try {
        const result = await post(path, body);
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain('injected');
        if (existing) {
          expect((await get('/' + existing.id)).body.meeting).toEqual(existing);
        } else {
          expect(
            (
              await pool.query('SELECT id FROM meetings WHERE create_request_id=$1', [
                (body as ReturnType<typeof draft>).requestId,
              ])
            ).rows,
          ).toEqual([]);
        }
        expect(
          (
            await pool.query(
              'SELECT member_id FROM meeting_attendees WHERE member_id=ANY($1::uuid[])',
              [addedMembers.map((member) => member.id)],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await pool.query('DROP TRIGGER fail_batch_attendee ON meeting_attendees');
        await pool.query('DROP FUNCTION fail_batch_attendee()');
      }
      const retry = await post(path, body);
      expect(retry.status).toBe(operation === 'create' ? 201 : 200);
      expect(retry.body.meeting.attendees).toHaveLength(2);
    },
  );
});

describe('Creator lifecycle: immutable schedule and atomic changes', () => {
  it.each(['date', 'startsAt', 'endsAt'])(
    'rejects even unchanged locked field %s at API',
    async (field) => {
      const m = await create();
      const r = await post('/' + m.id + '/edit', {
        expectedUpdatedAt: m.updatedAt,
        [field]: field === 'date' ? '2026-10-08' : m[field],
      });
      expect(r.status).toBe(400);
      expect(r.body.error.fields[field]).toBeTruthy();
      expect((await get('/' + m.id)).body.meeting).toEqual(m);
    },
  );
  it('edits past/Cancelled details independently; same-value/no-op does not change version; replay returns current row', async () => {
    const body = draft();
    const created = await post('', body);
    let m = created.body.meeting;
    await pool.query(
      "UPDATE meetings SET starts_at='2000-01-01T00:00:00Z',ends_at='2000-01-01T01:00:00Z' WHERE id=$1",
      [m.id],
    );
    m = (await get('/' + m.id)).body.meeting;
    const cancelled = await post('/' + m.id + '/cancel', { expectedUpdatedAt: m.updatedAt });
    expect(cancelled.status).toBe(200);
    const c = cancelled.body.meeting;
    expect(c.status).toBe('CANCELLED');
    expect(c.updatedAt).not.toBe(m.updatedAt);
    expect(
      (await post('/' + m.id + '/cancel', { expectedUpdatedAt: c.updatedAt })).body.meeting
        .updatedAt,
    ).toBe(c.updatedAt);
    const edited = await post('/' + m.id + '/edit', {
      expectedUpdatedAt: c.updatedAt,
      description: 'Revised',
      preparationNotes: null,
      status: 'CONFIRMED',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.meeting).toMatchObject({
      description: 'Revised',
      preparationNotes: null,
      status: 'CONFIRMED',
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      id: m.id,
      createdAt: m.createdAt,
    });
    const e = edited.body.meeting;
    expect(
      (await post('/' + m.id + '/edit', { expectedUpdatedAt: e.updatedAt, description: 'Revised' }))
        .body.meeting.updatedAt,
    ).toBe(e.updatedAt);
    expect((await post('', { requestId: body.requestId })).body.meeting).toEqual(e);
  });
  it('denies noncreator mutations and keeps creator-only M3 separate from team Summary', async () => {
    const m = await create();
    expect((await get('/' + m.id, attendee)).status).toBe(404);
    expect((await get('/' + m.id + '/summary', attendee)).status).toBe(200);
    for (const operation of ['edit', 'cancel', 'team']) {
      const body =
        operation === 'team'
          ? { expectedUpdatedAt: m.updatedAt, addMemberIds: [], removeEmails: [] }
          : { expectedUpdatedAt: m.updatedAt, title: 'Attempt' };
      if (operation === 'cancel') delete (body as { title?: string }).title;
      expect((await post('/' + m.id + '/' + operation, body, attendee)).status).toBe(404);
    }
  });
  it('serializes conflicting version edits: exactly one succeeds and the other is stale', async () => {
    const m = await create();
    const results = await Promise.all(
      ['One', 'Two'].map((title) =>
        post('/' + m.id + '/edit', { expectedUpdatedAt: m.updatedAt, title }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('STALE_MEETING');
  });
  it('saves details+team atomically, preserves guests and removes access immediately after explicit removal', async () => {
    const m = await create();
    await pool.query(
      'INSERT INTO meeting_attendees(meeting_id,email,display_name) VALUES($1,$2,$3)',
      [m.id, guestUser.email, 'Guest'],
    );
    expect(
      (await model.findSummary(ownerUser, m.id))!.attendees.some((a) => a.memberId === null),
    ).toBe(true);
    const invalid = await post('/' + m.id + '/edit', {
      expectedUpdatedAt: m.updatedAt,
      title: 'Must rollback',
      attendeeChanges: { addMemberIds: [randomUUID()], removeEmails: [guestUser.email] },
    });
    expect(invalid.status).toBe(400);
    expect((await get('/' + m.id)).body.meeting.title).toBe(m.title);
    expect(
      (await model.findSummary(ownerUser, m.id))!.attendees.some(
        (a) => a.email === guestUser.email,
      ),
    ).toBe(true);
    const result = await post('/' + m.id + '/team', {
      expectedUpdatedAt: m.updatedAt,
      addMemberIds: [],
      removeEmails: [guestUser.email],
    });
    expect(result.status).toBe(200);
    expect(
      (await model.findSummary(ownerUser, m.id))!.attendees.some(
        (a) => a.email === guestUser.email,
      ),
    ).toBe(false);
    expect((await model.findSummary(teamUser, m.id))!.attendeeCount).toBe(1);
  });
  it('rejects removing the last member and add/remove ambiguity without partial writes', async () => {
    const m = await create();
    for (const addMemberIds of [[], [attendee]]) {
      const r = await post('/' + m.id + '/team', {
        expectedUpdatedAt: m.updatedAt,
        addMemberIds,
        removeEmails: [teamUser.email],
      });
      expect(r.status).toBe(400);
      expect((await get('/' + m.id)).body.meeting).toEqual(m);
    }
  });
});

describe('Authorized summary and three section retrieval', () => {
  it('QA-MM-D001 excludes organizer identities and preserves first snapshots, distinct names and Guests without writes', async () => {
    const m = await create();
    const secondMember = randomUUID();
    await pool.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)', [
      secondMember,
      'other@example.test',
      teamUser.displayName,
    ]);
    for (const [email, memberId, name] of [
      [ownerUser.email, null, 'Organizer ghost'],
      ['old-owner@example.test', owner, 'Old organizer'],
      ['a-old-team@example.test', attendee, 'First snapshot'],
      ['other@example.test', secondMember, 'First snapshot'],
      [guestUser.email, null, 'First snapshot'],
    ])
      await pool.query(
        'INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,$2,$3,$4)',
        [m.id, email, name, memberId],
      );
    const before = (
      await pool.query('SELECT * FROM meeting_attendees WHERE meeting_id=$1 ORDER BY email', [m.id])
    ).rows;
    const summary = await get('/' + m.id + '/summary');
    const list = await get('?date=2026-10-08');
    expect(summary.status).toBe(200);
    expect(list.status).toBe(200);
    const listed = Object.values(list.body.groups)
      .flatMap((g: any) => g.items)
      .find((item: any) => item.id === m.id);
    for (const view of [summary.body.meeting, listed]) {
      expect(view.attendees).toEqual([
        { memberId: attendee, displayName: 'First snapshot', email: 'a-old-team@example.test' },
        { memberId: null, displayName: 'First snapshot', email: guestUser.email },
        { memberId: secondMember, displayName: 'First snapshot', email: 'other@example.test' },
      ]);
      expect(view.attendeeCount).toBe(3);
    }
    expect(
      (
        await pool.query('SELECT * FROM meeting_attendees WHERE meeting_id=$1 ORDER BY email', [
          m.id,
        ])
      ).rows,
    ).toEqual(before);
    expect((await get('/' + m.id)).body.meeting.updatedAt).toBe(m.updatedAt);
  });
  it.each(['team', 'edit'])(
    'QA-MM-D001 rejects organizer ghost as last attendee in %s and rolls back details/version',
    async (operation) => {
      const m = await create();
      await pool.query(
        'INSERT INTO meeting_attendees(meeting_id,email,display_name) VALUES($1,$2,$3)',
        [m.id, ownerUser.email, 'Organizer ghost'],
      );
      const before = (await get('/' + m.id)).body.meeting;
      const changes = { addMemberIds: [], removeEmails: [teamUser.email] };
      const result = await post('/' + m.id + '/' + operation, {
        expectedUpdatedAt: m.updatedAt,
        ...(operation === 'team' ? changes : { title: 'Must rollback', attendeeChanges: changes }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect((await get('/' + m.id)).body.meeting).toEqual(before);
      expect(
        (
          await pool.query(
            'SELECT email FROM meeting_attendees WHERE meeting_id=$1 ORDER BY email',
            [m.id],
          )
        ).rows.map((a) => a.email),
      ).toEqual([ownerUser.email, teamUser.email]);
    },
  );
  it('QA-MM-D001 retained duplicate and existing Guest each satisfy minimum after explicit snapshot removal', async () => {
    const m = await create();
    await pool.query(
      'INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,$2,$3,$4)',
      [m.id, 'old-team@example.test', 'Old team', attendee],
    );
    const removed = await post('/' + m.id + '/team', {
      expectedUpdatedAt: m.updatedAt,
      addMemberIds: [],
      removeEmails: [teamUser.email],
    });
    expect(removed.status).toBe(200);
    expect(removed.body.meeting.attendees).toEqual([
      { memberId: attendee, email: 'old-team@example.test', displayName: 'Old team' },
    ]);
    await pool.query(
      'INSERT INTO meeting_attendees(meeting_id,email,display_name) VALUES($1,$2,$3)',
      [m.id, guestUser.email, 'Guest'],
    );
    const guestOnly = await post('/' + m.id + '/team', {
      expectedUpdatedAt: removed.body.meeting.updatedAt,
      addMemberIds: [],
      removeEmails: ['old-team@example.test'],
    });
    expect(guestOnly.status).toBe(200);
    expect((await model.findSummary(ownerUser, m.id))!.attendeeCount).toBe(1);
  });
  it('QA-MM-D001 identified member with organizer snapshot email remains a real participant', async () => {
    const m = await create();
    await pool.query('UPDATE meeting_attendees SET email=$2 WHERE meeting_id=$1', [
      m.id,
      ownerUser.email,
    ]);
    expect((await get('/' + m.id + '/summary')).body.meeting.attendeeCount).toBe(1);
    const noOp = await post('/' + m.id + '/team', {
      expectedUpdatedAt: m.updatedAt,
      addMemberIds: [],
      removeEmails: [],
    });
    expect(noOp.status).toBe(200);
    expect(noOp.body.meeting.updatedAt).toBe(m.updatedAt);
  });
  it('QA-MM-D002 actual startup preserves same-process paging/authentication but rejects old cursors after restart', async () => {
    for (let i = 0; i < 11; i++) {
      const r = await post('', {
        ...draft(),
        startsAt: '2099-01-01T02:00:00Z',
        endsAt: '2099-01-01T04:00:00Z',
      });
      expect(r.status).toBe(201);
    }
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const key = randomBytes(32);
    const token = await new TokenService({ ...config, signingKey: key }).issue({
      authMethod: 'password',
      subject: owner,
    });
    let child: ChildProcess | undefined;
    const start = async () => {
      child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          PORT: String(port),
          DATABASE_URL: databaseUrl,
          ALLOWED_ORIGIN: config.allowedOrigin,
          JWT_SIGNING_KEY_BASE64: key.toString('base64'),
          COOKIE_SECURE: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Owned server readiness timeout')), 15000);
        child!.stdout!.on('data', (data) => {
          if (data.toString().includes('Backend listening')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child!.once('exit', (code) => {
          clearTimeout(timeout);
          reject(Error('Owned server exited ' + code));
        });
      });
    };
    const stop = async () => {
      if (child && child.exitCode === null) {
        const c = child,
          ended = once(c, 'exit');
        const timeout = setTimeout(() => c.kill('SIGKILL'), 12000);
        c.kill('SIGTERM');
        try {
          await ended;
        } finally {
          clearTimeout(timeout);
        }
      }
      child = undefined;
    };
    const read = (suffix = '&page=1') =>
      fetch('http://127.0.0.1:' + port + '/api/v1/meetings?date=2099-01-01&pageSize=10' + suffix, {
        headers: { Cookie: 'mm_access=' + token.token },
      });
    try {
      await start();
      const first = await read();
      expect(first.status).toBe(200);
      const initial = (await first.json()) as any;
      expect(initial.groups.upcomingCurrent.items).toHaveLength(10);
      const cursor = initial.snapshot;
      expect(typeof cursor).toBe('string');
      const suffix = '&section=upcomingCurrent&page=2&snapshot=' + encodeURIComponent(cursor);
      const continued = await read(suffix);
      expect(continued.status).toBe(200);
      expect(((await continued.json()) as any).group.items).toHaveLength(1);
      await stop();
      await start();
      const replay = await read(suffix);
      expect(replay.status).toBe(400);
      expect(((await replay.json()) as any).error.code).toBe('INVALID_CURSOR');
      const recovered = await read();
      expect(recovered.status).toBe(200);
      const fresh = (await recovered.json()) as any;
      const next = await read(
        '&section=upcomingCurrent&page=2&snapshot=' + encodeURIComponent(fresh.snapshot),
      );
      expect(next.status).toBe(200);
      expect(((await next.json()) as any).group.items).toHaveLength(1);
    } finally {
      await stop();
    }
  }, 45000);
  it('Member uses stable member ID; legacy email-only attendees remain data and candidate email stays private', async () => {
    const m = await create();
    const core = await model.findSummary(teamUser, m.id);
    expect(core).not.toBeNull();
    expect(core!.candidate).toEqual({ name: 'Candidate' });
    expect(core).not.toHaveProperty('creatorId');
    expect(
      await model.findSummary({ ...ownerUser, id: randomUUID(), email: teamUser.email }, m.id),
    ).toBeNull();
    await pool.query('UPDATE meeting_attendees SET member_id=NULL WHERE meeting_id=$1', [m.id]);
    expect(await model.findSummary(teamUser, m.id)).not.toBeNull();
    expect(
      (await model.findSummary(ownerUser, m.id))!.attendees.some(
        (a) => a.email === guestUser.email,
      ),
    ).toBe(false);
  });
  it('returns10 Current per batch and only latest5 each combined/Past, exact counts, date and access scope', async () => {
    await pool.query('DELETE FROM meeting_attendees');
    await pool.query('DELETE FROM meetings');
    const timing = (
      await pool.query(`SELECT
      to_char((clock_timestamp()-interval '2 hours') AT TIME ZONE 'Asia/Bangkok','YYYY-MM-DD') AS day,
      clock_timestamp()-interval '2 hours' AS starts,
      clock_timestamp()-interval '1 hour' AS ends`)
    ).rows[0];
    const date = timing.day as string;
    const ids: string[] = [];
    for (let i = 0; i < 35; i++) {
      const id = randomUUID();
      ids.push(id);
      const status = i >= 17 && i < 26 ? (i % 2 ? 'REJECTED' : 'CANCELLED') : 'PENDING';
      const end = i >= 26 ? timing.ends.toISOString() : '2099-01-01T00:00:00Z';
      await pool.query(
        `INSERT INTO meetings(id,creator_id,create_request_id,title,candidate_name,candidate_email,position,starts_at,ends_at,status)
        VALUES($1,$2,$3,$4,'Candidate','bulk@example.test','Engineer',$7,$5,$6)`,
        [id, owner, randomUUID(), 'Batch ' + i, end, status, timing.starts.toISOString()],
      );
    }
    const r = await get('?date=' + date);
    expect(r.status).toBe(200);
    expect(r.body.groups.upcomingCurrent.total).toBe(17);
    expect(r.body.groups.upcomingCurrent.items).toHaveLength(10);
    expect(r.body.groups.rejectedCancelled.count).toBe(9);
    expect(r.body.groups.rejectedCancelled.items).toHaveLength(5);
    expect(r.body.groups.past.count).toBe(9);
    expect(r.body.groups.past.items).toHaveLength(5);
    const smallFirst = await get('?date=' + date + '&pageSize=3');
    expect(smallFirst.status).toBe(200);
    expect(smallFirst.body.groups.upcomingCurrent).toMatchObject({
      page: 1,
      pageSize: 3,
      total: 17,
      totalPages: 6,
    });
    expect(smallFirst.body.groups.upcomingCurrent.items).toHaveLength(3);
    const smallLast = await get(
      '?date=' +
        date +
        '&section=upcomingCurrent&page=6&pageSize=3&snapshot=' +
        encodeURIComponent(smallFirst.body.snapshot),
    );
    expect(smallLast.status).toBe(200);
    expect(smallLast.body.group.items).toHaveLength(2);
    expect(smallLast.body.group.totalPages).toBe(6);
    const cursor = r.body.snapshot;
    const next = await get(
      '?date=' + date + '&section=upcomingCurrent&page=2&snapshot=' + encodeURIComponent(cursor),
    );
    expect(next.status).toBe(200);
    expect(next.body.group.items).toHaveLength(7);
    expect(next.body.group.page).toBe(2);
    expect(next.body.group.total).toBe(17);
    const beyond = await get(
      '?date=' + date + '&section=upcomingCurrent&page=3&snapshot=' + encodeURIComponent(cursor),
    );
    expect(beyond.status).toBe(200);
    expect(beyond.body.group).toMatchObject({
      items: [],
      page: 3,
      pageSize: 10,
      total: 17,
      totalPages: 2,
    });
    expect(beyond.body.referenceTime).toBe(r.body.referenceTime);
    const firstAgain = await get(
      '?date=' + date + '&section=upcomingCurrent&page=1&snapshot=' + encodeURIComponent(cursor),
    );
    expect(firstAgain.body.group.items).toEqual(r.body.groups.upcomingCurrent.items);
    expect(
      new Set([...r.body.groups.upcomingCurrent.items, ...next.body.group.items].map((m) => m.id))
        .size,
    ).toBe(17);
    const outsider = await get('?date=' + date, attendee);
    expect(outsider.body.groups.upcomingCurrent.total).toBe(0);
    expect(
      (
        await get(
          '?date=' +
            date +
            '&section=upcomingCurrent&page=2&snapshot=' +
            encodeURIComponent(cursor),
          attendee,
        )
      ).status,
    ).toBe(400);
    await pool.query('UPDATE meetings SET title=$2,updated_at=clock_timestamp() WHERE id=$1', [
      ids[0],
      'Changed',
    ]);
    const stale = await get(
      '?date=' + date + '&section=upcomingCurrent&page=2&snapshot=' + encodeURIComponent(cursor),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('LIST_CHANGED');
  });
  it('rejects malformed and unsupported query controls instead of silently widening scope', async () => {
    for (const query of [
      'date=2026-02-30',
      'date=2026-10-08&limit=100',
      'date=2026-10-08&section=past&cursor=e30',
      'date=2026-10-08&section=upcomingCurrent&page=2&snapshot=e30.bad',
    ])
      expect((await get('?' + query)).status).toBe(400);
  });
  it('Candidate is denied before list, Summary and mutation lookup', async () => {
    const m = await create();
    await pool.query('UPDATE meetings SET candidate_email=$2 WHERE id=$1', [m.id, teamUser.email]);
    expect((await get('?date=2026-10-08', attendee)).status).toBe(403);
    expect((await get('/' + m.id + '/summary', attendee)).status).toBe(403);
    expect(
      (
        await post(
          '/' + m.id + '/edit',
          { expectedUpdatedAt: m.updatedAt, title: 'Denied' },
          attendee,
        )
      ).status,
    ).toBe(403);
  });
});

describe('Creator Delete and terminal create-key receipts', () => {
  it('deletes a past Cancelled meeting and its team atomically while preserving other records and users', async () => {
    const m = await create();
    await pool.query(
      "UPDATE meetings SET status='CANCELLED',starts_at='2000-01-01T00:00:00Z',ends_at='2000-01-01T01:00:00Z' WHERE id=$1",
      [m.id],
    );
    const deleted = await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt });
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe('');
    expect(
      (await pool.query('SELECT * FROM meeting_attendees WHERE meeting_id=$1', [m.id])).rows,
    ).toHaveLength(0);
    expect((await get('/' + m.id)).status).toBe(404);
    expect((await get('/' + m.id + '/summary', attendee)).status).toBe(404);
    expect((await get('/' + fixtureIds.meeting)).status).toBe(200);
    expect((await pool.query('SELECT id FROM users')).rows).toHaveLength(4);
    const receipt = (
      await pool.query('SELECT * FROM deleted_meeting_requests WHERE meeting_id=$1', [m.id])
    ).rows[0];
    expect(Object.keys(receipt).sort()).toEqual(['create_request_id', 'creator_id', 'meeting_id']);
    currentTime = '2030-01-01T00:00:00Z';
    const late = await post('', { requestId: receipt.create_request_id, invalid: 'payload' });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('MEETING_DELETED');
    expect((await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt })).status).toBe(
      404,
    );
    expect((await pool.query('SELECT id FROM meetings WHERE id=$1', [m.id])).rows).toHaveLength(0);
  });
  it('enforces creator, current identity, version and strict delete body without leaking receipts', async () => {
    const m = await create();
    expect(
      (await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt }, attendee)).status,
    ).toBe(404);
    expect(
      (await post('/' + m.id + '/delete', { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }))
        .status,
    ).toBe(409);
    expect(
      (await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt, force: true })).status,
    ).toBe(400);
    expect((await pool.query('SELECT * FROM deleted_meeting_requests')).rows).toHaveLength(0);
    const body = draft(),
      created = await post('', body);
    expect(
      (
        await post('/' + created.body.meeting.id + '/delete', {
          expectedUpdatedAt: created.body.meeting.updatedAt,
        })
      ).status,
    ).toBe(204);
    // Same UUID belongs to a different creator's namespace and exposes no deleted result.
    expect((await post('', { requestId: body.requestId }, attendee)).status).toBe(400);
    await pool.query('UPDATE meetings SET candidate_email=$2 WHERE id=$1', [m.id, ownerUser.email]);
    expect((await post('', { requestId: body.requestId })).status).toBe(403);
  });
  it('rolls back receipt and child deletion when parent deletion fails', async () => {
    const m = await create();
    await pool.query(
      "CREATE FUNCTION fail_meeting_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private injected failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER fail_delete BEFORE DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION fail_meeting_delete()',
    );
    try {
      const r = await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt });
      expect(r.status).toBe(503);
      expect(JSON.stringify(r.body)).not.toContain('private injected');
      expect((await get('/' + m.id)).body.meeting).toEqual(m);
      expect(
        (await pool.query('SELECT * FROM deleted_meeting_requests WHERE meeting_id=$1', [m.id]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await pool.query('DROP TRIGGER fail_delete ON meetings');
      await pool.query('DROP FUNCTION fail_meeting_delete()');
    }
    expect((await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt })).status).toBe(
      204,
    );
  });
  it('lost real COMMIT acknowledgement returns503 while persisted receipt prevents resurrection', async () => {
    const body = draft();
    const m = (await post('', body)).body.meeting;
    const actual = await pool.connect();
    const wrapped = {
      connect: async () => ({
        query: async (sql: string, values?: unknown[]) => {
          const result = await actual.query(sql, values);
          if (sql === 'COMMIT') throw new Error('injected acknowledgement loss');
          return result;
        },
        release: (discard?: boolean) => actual.release(discard),
      }),
    };
    await expect(
      new MeetingModel(wrapped as unknown as Pool).deleteMeeting(owner, m.id, m.updatedAt),
    ).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    expect((await get('/' + m.id)).status).toBe(404);
    const late = await post('', { requestId: body.requestId });
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe('MEETING_DELETED');
  });
  it.each(['COMMIT', 'ROLLBACK'] as const)(
    'late create waits for delete-key serialization; deleting transaction %s',
    async (disposition) => {
      const body = draft();
      const m = (await post('', body)).body.meeting;
      const deleting = await pool.connect();
      const contenderPool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        application_name: 'meeting-delete-late-create',
      });
      let result: Promise<unknown> | undefined;
      try {
        await deleting.query('BEGIN');
        await deleting.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          owner + ':' + body.requestId,
        ]);
        await deleting.query(
          'INSERT INTO deleted_meeting_requests(creator_id,create_request_id,meeting_id) VALUES($1,$2,$3)',
          [owner, body.requestId, m.id],
        );
        await deleting.query('DELETE FROM meeting_attendees WHERE meeting_id=$1', [m.id]);
        await deleting.query('DELETE FROM meetings WHERE id=$1', [m.id]);
        result = new MeetingModel(contenderPool).create(owner, {
          ...body,
          status: 'PENDING',
          format: 'ONSITE',
          location: null,
        });
        void result.catch(() => {});
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (
            (
              await pool.query(
                "SELECT 1 FROM pg_stat_activity WHERE application_name='meeting-delete-late-create' AND wait_event_type='Lock'",
              )
            ).rows.length
          ) {
            blocked = true;
            break;
          }
          await delay(10);
        }
        expect(blocked).toBe(true);
        // The reader sees the old active snapshot, never an invented unused-key gap.
        expect((await model.findByRequestId(owner, body.requestId))!.id).toBe(m.id);
        await deleting.query(disposition);
        if (disposition === 'COMMIT') {
          await expect(result).rejects.toMatchObject({ status: 410, code: 'MEETING_DELETED' });
          await expect(model.findByRequestId(owner, body.requestId)).rejects.toMatchObject({
            status: 410,
          });
          expect(
            (
              await pool.query('SELECT id FROM meetings WHERE create_request_id=$1', [
                body.requestId,
              ])
            ).rows,
          ).toHaveLength(0);
        } else {
          expect(await result).toMatchObject({ created: false, meeting: { id: m.id } });
          expect(
            (await pool.query('SELECT * FROM deleted_meeting_requests WHERE meeting_id=$1', [m.id]))
              .rows,
          ).toHaveLength(0);
        }
      } finally {
        await deleting.query('ROLLBACK');
        deleting.release();
        await result?.catch(() => {});
        await contenderPool.end();
      }
    },
  );
});
