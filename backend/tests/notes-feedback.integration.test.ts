import { setTimeout as delay } from 'node:timers/promises';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
  if (/\/feedback(?:\?|$)/.test(path) || path.startsWith('?')) {
    const [pathname, search = ''] = path.split('?');
    const query = new URLSearchParams(search);
    if (!query.has('page')) query.set('page', '1');
    if (!query.has('pageSize')) query.set('pageSize', path.startsWith('?') ? '10' : '50');
    path = pathname + '?' + query;
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

async function guest(
  method: 'get' | 'post',
  path: string,
  body?: unknown,
  email = guestUser.email,
) {
  const cookie =
    'mm_access=' +
    (
      await tokens.issue({
        authMethod: 'google',
        subject: 'google:content-test',
        verifiedEmail: email,
      })
    ).token;
  if (method === 'get' && path.endsWith('/feedback')) path += '?page=1&pageSize=50';
  const req = request(app)
    [method]('/api/v1/meetings' + path)
    .set('Cookie', cookie)
    .set('Origin', config.allowedOrigin)
    .set('X-Requested-With', 'MeetingManager');
  return method === 'post' ? req.send(body) : req;
}
async function addGuest(meetingId: string) {
  await pool.query(
    'INSERT INTO meeting_attendees(meeting_id,email,display_name) VALUES($1,$2,$3)',
    [meetingId, guestUser.email, 'Guest'],
  );
}
async function waitForLock(name: string) {
  for (let n = 0; n < 100; n++) {
    if (
      (
        await pool.query(
          'SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type=$2',
          [name, 'Lock'],
        )
      ).rows.length
    )
      return;
    await delay(10);
  }
  throw new Error('Expected database lock was not observed');
}

describe('Author-private Interview Notes', () => {
  it('distinguishes never-saved from saved empty and preserves verbatim whitespace', async () => {
    const m = await create();
    const path = '/' + m.id + '/notes/me';
    expect((await get(path)).body).toEqual({ note: null });
    const empty = await post(path, { text: '', expectedUpdatedAt: null });
    expect(empty.status).toBe(200);
    expect(empty.body.note.text).toBe('');
    expect((await get(path)).body).toEqual(empty.body);
    const changed = await post(path, {
      text: '  private\n  ',
      expectedUpdatedAt: empty.body.note.updatedAt,
    });
    expect(changed.status).toBe(200);
    expect(changed.body.note.text).toBe('  private\n  ');
    expect(changed.body.note.updatedAt).not.toBe(empty.body.note.updatedAt);
  });
  it('isolates authors and ignores display-name equality; Summary never includes private content', async () => {
    const m = await create(),
      path = '/' + m.id + '/notes/me';
    const a = await post(path, { text: 'Owner private', expectedUpdatedAt: null });
    const b = await post(path, { text: 'Team private', expectedUpdatedAt: null }, attendee);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await get(path)).body.note.text).toBe('Owner private');
    expect((await get(path, attendee)).body.note.text).toBe('Team private');
    expect((await get(path + '?authorId=' + owner, attendee)).status).toBe(400);
    expect(
      (
        await post(
          path,
          { text: 'Steal', expectedUpdatedAt: null, author_key: 'member:' + owner },
          attendee,
        )
      ).status,
    ).toBe(400);
    const summary = await get('/' + m.id + '/summary', attendee);
    expect(JSON.stringify(summary.body)).not.toContain('private');
    expect(summary.body.meeting.preparationNotes).toBe('Bring portfolio');
  });
  it('same-content retry is idempotent while stale different content conflicts', async () => {
    const m = await create(),
      path = '/' + m.id + '/notes/me';
    const first = await post(path, { text: 'One', expectedUpdatedAt: null });
    expect((await post(path, { text: 'One', expectedUpdatedAt: null })).body).toEqual(first.body);
    const second = await post(path, { text: 'Two', expectedUpdatedAt: first.body.note.updatedAt });
    expect(second.status).toBe(200);
    const stale = await post(path, { text: 'Three', expectedUpdatedAt: first.body.note.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NOTE_CHANGED');
    expect((await get(path)).body).toEqual(second.body);
  });
  it('serializes concurrent new writes from the same author without silently overwriting', async () => {
    const m = await create();
    const rows = await Promise.all(
      ['A', 'B'].map((text) => post('/' + m.id + '/notes/me', { text, expectedUpdatedAt: null })),
    );
    expect(rows.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await pool.query('SELECT * FROM interview_notes WHERE meeting_id=$1', [m.id])).rows,
    ).toHaveLength(1);
  });
  it('Google Member and Password Member share author identity; Guest namespace is not silently migrated', async () => {
    const m = await create(),
      path = '/' + m.id + '/notes/me';
    await post(path, { text: 'Member note', expectedUpdatedAt: null });
    expect((await guest('get', path, undefined, ownerUser.email)).body.note.text).toBe(
      'Member note',
    );
    await addGuest(m.id);
    expect(
      (await guest('post', path, { text: 'Guest note', expectedUpdatedAt: null })).status,
    ).toBe(401);
    await pool.query(
      'INSERT INTO interview_notes(meeting_id,author_key,content) VALUES($1,$2,$3)',
      [m.id, 'guest:' + guestUser.email, 'Guest note'],
    );
    const newId = randomUUID();
    await pool.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)', [
      newId,
      guestUser.email,
      'New Member',
    ]);
    expect((await get(path, newId)).body).toEqual({ note: null });
    expect(
      (
        await pool.query(
          'SELECT content FROM interview_notes WHERE meeting_id=$1 AND author_key=$2',
          [m.id, 'guest:' + guestUser.email],
        )
      ).rows[0].content,
    ).toBe('Guest note');
  });
});

describe('Feedback one per author, own edits and controlled older reads', () => {
  it('trims new text, returns exact timestamps and keeps author internals private', async () => {
    const m = await create(),
      path = '/' + m.id + '/feedback';
    const created = await post(path, { requestId: randomUUID(), text: '  Insight\n  ' });
    expect(created.status).toBe(201);
    const f = created.body.feedback;
    expect(f.text).toBe('Insight');
    expect(f.createdAt).toBe(f.updatedAt);
    expect(f.isOwn).toBe(true);
    expect(Object.keys(f.author)).toEqual(['displayName']);
    expect(JSON.stringify(f)).not.toContain(ownerUser.email);
    expect(f).not.toHaveProperty('author_key');
    const read = await get(path);
    expect(read.body).toMatchObject({
      items: [f],
      ownFeedbackId: f.id,
      page: 1,
      pageSize: 50,
      total: 1,
    });
    expect(typeof read.body.snapshot).toBe('string');
  });
  it.each(['', '   ', '\n\t'])(
    'rejects blank Feedback %j without reserving author or key',
    async (text) => {
      const m = await create(),
        path = '/' + m.id + '/feedback',
        requestId = randomUUID();
      expect((await post(path, { requestId, text })).status).toBe(400);
      expect((await post(path, { requestId, text: 'Valid' })).status).toBe(201);
    },
  );
  it('two different concurrent keys produce one201 and one409; matching key replays before text validation', async () => {
    const m = await create(),
      path = '/' + m.id + '/feedback';
    const requests = [
      { requestId: randomUUID(), text: 'First' },
      { requestId: randomUUID(), text: 'Second' },
    ];
    const results = await Promise.all(requests.map((body) => post(path, body)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('FEEDBACK_EXISTS');
    const i = results.findIndex((r) => r.status === 201);
    const replay = await post(path, { requestId: requests[i]!.requestId, text: null });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(results[i]!.body);
    expect(
      (await post(path, { requestId: requests[i]!.requestId, authorKey: 'spoof' })).status,
    ).toBe(400);
    expect(
      (await pool.query('SELECT id FROM meeting_feedback WHERE meeting_id=$1', [m.id])).rows,
    ).toHaveLength(1);
  });
  it('same-key concurrent create returns201/200 with the same persisted row', async () => {
    const m = await create(),
      body = { requestId: randomUUID(), text: 'Once' };
    const results = await Promise.all([
      post('/' + m.id + '/feedback', body),
      post('/' + m.id + '/feedback', body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body).toEqual(results[1]!.body);
  });
  it('only author may edit; same-text retry is no-op, stale changed text conflicts and createdAt stays fixed', async () => {
    const m = await create(),
      path = '/' + m.id + '/feedback';
    const first = (await post(path, { requestId: randomUUID(), text: 'Original' }, attendee)).body
      .feedback;
    expect(
      (
        await post(path + '/' + first.id + '/edit', {
          text: 'Owner overwrite',
          expectedUpdatedAt: first.updatedAt,
        })
      ).status,
    ).toBe(404);
    const edit = await post(
      path + '/' + first.id + '/edit',
      { text: '  Revised  ', expectedUpdatedAt: first.updatedAt },
      attendee,
    );
    expect(edit.status).toBe(200);
    expect(edit.body.feedback).toMatchObject({
      text: 'Revised',
      createdAt: first.createdAt,
      isOwn: true,
    });
    expect(edit.body.feedback.updatedAt).not.toBe(first.updatedAt);
    expect(
      (
        await post(
          path + '/' + first.id + '/edit',
          { text: 'Revised', expectedUpdatedAt: first.updatedAt },
          attendee,
        )
      ).body,
    ).toEqual(edit.body);
    const conflict = await post(
      path + '/' + first.id + '/edit',
      { text: 'Stale', expectedUpdatedAt: first.updatedAt },
      attendee,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('FEEDBACK_CHANGED');
  });
  it('former Guest cannot access Feedback; eligible Members retain historical author content', async () => {
    const m = await create(),
      path = '/' + m.id + '/feedback';
    await addGuest(m.id);
    await post(path, { requestId: randomUUID(), text: 'Member feedback' });
    const mine = await guest('post', path, { requestId: randomUUID(), text: 'Guest feedback' });
    expect(mine.status).toBe(401);
    await pool.query(
      'INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content) VALUES($1,$2,$3,$4,$5,$6)',
      [
        randomUUID(),
        m.id,
        'guest:' + guestUser.email,
        'Historical Guest',
        randomUUID(),
        'Guest feedback',
      ],
    );
    const guestRead = await guest('get', path);
    expect(guestRead.status).toBe(401);
    expect(guestRead.body).not.toHaveProperty('items');
    const memberRead = await get(path);
    expect(memberRead.body.items).toHaveLength(2);
    expect(memberRead.body.total).toBe(2);
    expect(memberRead.body.items.filter((f) => f.isOwn)).toHaveLength(1);
    expect((await guest('get', path + '?author=' + owner)).status).toBe(401);
  });
  it('loads latest50 then older5 with full-set own ID, stable order, purpose/principal binding and no refresh on insert', async () => {
    const m = await create(),
      path = '/' + m.id + '/feedback';
    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const id = randomUUID();
      ids.push(id);
      await pool.query(
        `INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content,created_at,updated_at)
        VALUES($1,$2,$3,'Same displayed name',$4,$5,'2000-01-01T00:00:00Z'::timestamptz+$6*interval '1 microsecond','2000-01-01T00:00:00Z'::timestamptz+$6*interval '1 microsecond')`,
        [
          id,
          m.id,
          i === 0 ? 'member:' + owner : 'member:' + randomUUID(),
          randomUUID(),
          'Text ' + i,
          i,
        ],
      );
    }
    const latest = await get(path);
    expect(latest.status).toBe(200);
    expect(latest.body.items.map((f) => f.id)).toEqual(ids.slice(5));
    expect(latest.body.ownFeedbackId).toBe(ids[0]);
    expect(latest.body.items.some((f) => f.isOwn)).toBe(false);
    const cursor = latest.body.snapshot;
    expect(typeof cursor).toBe('string');
    await expect(
      new MeetingService(model).readFeedback(ownerUser, m.id, {
        page: '2',
        pageSize: '50',
        snapshot: cursor,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    expect(
      (await get(path + '?page=2&snapshot=' + encodeURIComponent(cursor), attendee)).status,
    ).toBe(400);
    expect(
      (
        await get(
          '?date=2026-10-08&section=upcomingCurrent&page=2&snapshot=' + encodeURIComponent(cursor),
        )
      ).status,
    ).toBe(400);
    await post(path, { requestId: randomUUID(), text: 'New from another author' }, attendee);
    const own = (
      await pool.query(
        'SELECT to_char(updated_at AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS version FROM meeting_feedback WHERE id=$1',
        [ids[0]],
      )
    ).rows[0];
    expect(
      (
        await post(path + '/' + ids[0] + '/edit', {
          text: 'Revised own old feedback',
          expectedUpdatedAt: own.version,
        })
      ).status,
    ).toBe(200);
    const older = await get(path + '?page=2&snapshot=' + encodeURIComponent(cursor));
    expect(older.status).toBe(200);
    expect(older.body.items.map((f) => f.id)).toEqual(ids.slice(0, 5));
    expect(older.body.page).toBe(2);
    expect(older.body.total).toBe(55);
    expect(older.body.asOf).toBe(latest.body.asOf);
    const beyond = await get(path + '?page=3&snapshot=' + encodeURIComponent(cursor));
    expect(beyond.status).toBe(200);
    expect(beyond.body).toMatchObject({ items: [], page: 3, pageSize: 50, total: 55 });

    expect(older.body.items[0].text).toBe('Revised own old feedback');
    expect(older.body.ownFeedbackId).toBe(ids[0]);
    expect((await get(path + '?page=2&snapshot=' + encodeURIComponent(cursor))).body).toEqual(
      older.body,
    );
    // A transaction may commit later with a created_at before the initial asOf.
    await pool.query(
      `INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content,created_at,updated_at)
      VALUES($1,$2,$3,'Late commit',$4,'Late eligible row','2000-01-01','2000-01-01')`,
      [randomUUID(), m.id, 'member:' + randomUUID(), randomUUID()],
    );
    const changed = await get(path + '?page=2&snapshot=' + encodeURIComponent(cursor));
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('LIST_CHANGED');
  });
});

describe('Current access, lifecycle retention and cascading content deletion', () => {
  it.each(['note', 'feedback-create', 'feedback-edit'] as const)(
    'reconciles a lost real COMMIT acknowledgement for %s without duplicate/version changes',
    async (operation) => {
      const m = await create(),
        requestId = randomUUID();
      let feedbackId = '',
        expectedUpdatedAt = '';
      if (operation === 'feedback-edit') {
        const first = (await post('/' + m.id + '/feedback', { requestId, text: 'Before' })).body
          .feedback;
        feedbackId = first.id;
        expectedUpdatedAt = first.updatedAt;
      }
      const actual = await pool.connect();
      const wrapped = {
        connect: async () => ({
          query: async (sql: string, values?: unknown[]) => {
            const result = await actual.query(sql, values);
            if (sql === 'COMMIT') throw new Error('injected lost acknowledgement');
            return result;
          },
          release: (discard?: boolean) => actual.release(discard),
        }),
      };
      const writer = new MeetingService(new MeetingModel(wrapped as unknown as Pool));
      const outcome =
        operation === 'note'
          ? writer.saveOwnNote(ownerUser, m.id, { text: 'Saved', expectedUpdatedAt: null })
          : operation === 'feedback-create'
            ? writer.createFeedback(ownerUser, m.id, { requestId, text: 'Saved' })
            : writer.editFeedback(ownerUser, m.id, feedbackId, {
                text: 'Saved',
                expectedUpdatedAt,
              });
      await expect(outcome).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      if (operation === 'note') {
        const persisted = await get('/' + m.id + '/notes/me');
        expect(
          (await post('/' + m.id + '/notes/me', { text: 'Saved', expectedUpdatedAt: null })).body,
        ).toEqual(persisted.body);
      } else {
        const persisted = (await get('/' + m.id + '/feedback')).body.items[0];
        const retry =
          operation === 'feedback-create'
            ? await post('/' + m.id + '/feedback', { requestId, text: 'Saved' })
            : await post('/' + m.id + '/feedback/' + feedbackId + '/edit', {
                text: 'Saved',
                expectedUpdatedAt,
              });
        expect(retry.status).toBe(200);
        expect(retry.body.feedback).toEqual(persisted);
        expect(
          (await pool.query('SELECT id FROM meeting_feedback WHERE meeting_id=$1', [m.id])).rows,
        ).toHaveLength(1);
      }
    },
  );
  it.each(['note', 'feedback'] as const)(
    'actual Delete wins parent lock against waiting %s write without orphan content',
    async (operation) => {
      const m = await create(),
        actual = await pool.connect();
      let notifyLocked!: () => void, allowDelete!: () => void;
      const locked = new Promise<void>((resolve) => {
        notifyLocked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        allowDelete = resolve;
      });
      const wrapped = {
        connect: async () => ({
          query: async (sql: string, values?: unknown[]) => {
            const result = await actual.query(sql, values);
            if (sql.startsWith('SELECT updated_at=') && sql.includes('FOR UPDATE')) {
              notifyLocked();
              await gate;
            }
            return result;
          },
          release: (discard?: boolean) => actual.release(discard),
        }),
      };
      const writerPool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        application_name: 'content-delete-race',
      });
      const deleting = new MeetingModel(wrapped as unknown as Pool).deleteMeeting(
        owner,
        m.id,
        m.updatedAt,
      );
      void deleting.catch(() => {});
      let pending: Promise<unknown> | undefined;
      try {
        await Promise.race([locked, deleting]);
        const writer = new MeetingService(new MeetingModel(writerPool));
        pending =
          operation === 'note'
            ? writer.saveOwnNote(ownerUser, m.id, { text: 'Late', expectedUpdatedAt: null })
            : writer.createFeedback(ownerUser, m.id, { requestId: randomUUID(), text: 'Late' });
        void pending.catch(() => {});
        await waitForLock('content-delete-race');
        allowDelete();
        await deleting;
        await expect(pending).rejects.toMatchObject({ status: 404, code: 'MEETING_NOT_FOUND' });
        for (const table of ['interview_notes', 'meeting_feedback'])
          expect(
            (await pool.query(`SELECT * FROM ${table} WHERE meeting_id=$1`, [m.id])).rows,
          ).toHaveLength(0);
      } finally {
        allowDelete();
        await deleting.catch(() => {});
        await pending?.catch(() => {});
        await writerPool.end();
      }
    },
  );
  it('retains all content on Edit/Cancel, Notes save does not update Feedback, and Delete removes both tables for every author', async () => {
    const m = await create();
    for (const id of [owner, attendee]) {
      await post('/' + m.id + '/notes/me', { text: 'Private ' + id, expectedUpdatedAt: null }, id);
      await post('/' + m.id + '/feedback', { requestId: randomUUID(), text: 'Feedback ' + id }, id);
    }
    const before = await pool.query(
      'SELECT * FROM meeting_feedback WHERE meeting_id=$1 ORDER BY id',
      [m.id],
    );
    const n = (await get('/' + m.id + '/notes/me')).body.note;
    await post('/' + m.id + '/notes/me', { text: 'Changed note', expectedUpdatedAt: n.updatedAt });
    expect(
      (await pool.query('SELECT * FROM meeting_feedback WHERE meeting_id=$1 ORDER BY id', [m.id]))
        .rows,
    ).toEqual(before.rows);
    const edited = await post('/' + m.id + '/edit', {
      expectedUpdatedAt: m.updatedAt,
      description: 'Details changed',
    });
    const cancelled = await post('/' + m.id + '/cancel', {
      expectedUpdatedAt: edited.body.meeting.updatedAt,
    });
    expect(cancelled.status).toBe(200);
    expect(
      (await pool.query('SELECT * FROM meeting_feedback WHERE meeting_id=$1 ORDER BY id', [m.id]))
        .rows,
    ).toEqual(before.rows);
    expect(
      (
        await post('/' + m.id + '/feedback', {
          requestId: randomUUID(),
          text: 'Not a second entitlement',
        })
      ).status,
    ).toBe(409);
    expect(
      (await post('/' + m.id + '/delete', { expectedUpdatedAt: cancelled.body.meeting.updatedAt }))
        .status,
    ).toBe(204);
    for (const table of ['interview_notes', 'meeting_feedback'])
      expect(
        (await pool.query(`SELECT * FROM ${table} WHERE meeting_id=$1`, [m.id])).rows,
      ).toHaveLength(0);
    expect(
      (await post('/' + m.id + '/notes/me', { text: 'Orphan', expectedUpdatedAt: null })).status,
    ).toBe(404);
    expect(
      (await post('/' + m.id + '/feedback', { requestId: randomUUID(), text: 'Orphan' })).status,
    ).toBe(404);
  });
  it('removed Guest loses all content access, including same-key Feedback replay', async () => {
    const m = await create();
    await addGuest(m.id);
    const body = { requestId: randomUUID(), text: 'Guest feedback' };
    await pool.query(
      'INSERT INTO interview_notes(meeting_id,author_key,content) VALUES($1,$2,$3)',
      [m.id, 'guest:' + guestUser.email, 'Guest note'],
    );
    expect(
      (await guest('post', '/' + m.id + '/notes/me', { text: 'Changed', expectedUpdatedAt: null }))
        .status,
    ).toBe(401);
    expect((await guest('post', '/' + m.id + '/feedback', body)).status).toBe(401);
    expect(
      (
        await post('/' + m.id + '/team', {
          expectedUpdatedAt: m.updatedAt,
          addMemberIds: [],
          removeEmails: [guestUser.email],
        })
      ).status,
    ).toBe(200);
    expect((await guest('get', '/' + m.id + '/notes/me')).status).toBe(401);
    expect((await guest('get', '/' + m.id + '/feedback')).status).toBe(401);
    expect((await guest('post', '/' + m.id + '/feedback', body)).status).toBe(401);
    expect(
      (await pool.query('SELECT * FROM interview_notes WHERE meeting_id=$1', [m.id])).rows,
    ).toHaveLength(1);
  });
  it('waiting writer rechecks team permission after acquiring the parent lock', async () => {
    const m = await create(),
      locked = await pool.connect();
    const writerPool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: 'notes-team-race',
    });
    let pending: Promise<unknown> | undefined;
    try {
      await locked.query('BEGIN');
      await locked.query('SELECT id FROM meetings WHERE id=$1 FOR UPDATE', [m.id]);
      pending = new MeetingService(new MeetingModel(writerPool)).saveOwnNote(teamUser, m.id, {
        text: 'Must not save',
        expectedUpdatedAt: null,
      });
      void pending.catch(() => {});
      await waitForLock('notes-team-race');
      await locked.query('DELETE FROM meeting_attendees WHERE meeting_id=$1 AND member_id=$2', [
        m.id,
        attendee,
      ]);
      await locked.query('COMMIT');
      await expect(pending).rejects.toMatchObject({ status: 404, code: 'MEETING_NOT_FOUND' });
      expect(
        (await pool.query('SELECT * FROM interview_notes WHERE meeting_id=$1', [m.id])).rows,
      ).toHaveLength(0);
    } finally {
      await locked.query('ROLLBACK');
      locked.release();
      await pending?.catch(() => {});
      await writerPool.end();
    }
  });
  it('content failure during cascade rolls back meeting, team, both content tables and receipt', async () => {
    const m = await create();
    await post('/' + m.id + '/notes/me', { text: 'Preserved', expectedUpdatedAt: null });
    await post('/' + m.id + '/feedback', { requestId: randomUUID(), text: 'Preserved' });
    await pool.query(
      "CREATE FUNCTION fail_content_cascade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private content failure'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER fail_content BEFORE DELETE ON meeting_feedback FOR EACH ROW EXECUTE FUNCTION fail_content_cascade()',
    );
    try {
      expect((await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt })).status).toBe(
        503,
      );
      for (const table of [
        'meetings',
        'meeting_attendees',
        'interview_notes',
        'meeting_feedback',
      ]) {
        const key = table === 'meetings' ? 'id' : 'meeting_id';
        expect(
          (await pool.query(`SELECT * FROM ${table} WHERE ${key}=$1`, [m.id])).rows,
        ).toHaveLength(1);
      }
      expect(
        (await pool.query('SELECT * FROM deleted_meeting_requests WHERE meeting_id=$1', [m.id]))
          .rows,
      ).toHaveLength(0);
    } finally {
      await pool.query('DROP TRIGGER fail_content ON meeting_feedback');
      await pool.query('DROP FUNCTION fail_content_cascade()');
    }
    expect((await post('/' + m.id + '/delete', { expectedUpdatedAt: m.updatedAt })).status).toBe(
      204,
    );
  });
  it('Candidate denial and CSRF protection run before content operations', async () => {
    const m = await create();
    await pool.query('UPDATE meetings SET candidate_email=$2 WHERE id=$1', [m.id, teamUser.email]);
    for (const path of ['/' + m.id + '/notes/me', '/' + m.id + '/feedback']) {
      expect((await get(path, attendee)).status).toBe(403);
      expect(
        (
          await post(
            path,
            { text: 'Denied', requestId: randomUUID(), expectedUpdatedAt: null },
            attendee,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v1/meetings' + path)
            .set('Cookie', await access())
            .send({})
        ).status,
      ).toBe(403);
    }
  });
});
