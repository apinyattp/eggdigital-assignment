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
    'TRUNCATE interview_notes,meeting_feedback,deleted_meeting_requests,meeting_attendees,meetings,users',
  );
  await seedLoginFixtures(pool, password);
});
afterAll(async () => {
  await pool.end();
});

describe('Manual Online fallback without external provider calls', () => {
  it('creates, replays and edits the manual link while preserving schedule and permissions', async () => {
    const body = { ...draft(), format: 'ONLINE', joinUrl: 'https://meet.google.com/abc-defg-hij' };
    const created = await post('', body);
    expect(created.status).toBe(201);
    const m = created.body.meeting;
    expect(m).toMatchObject({
      joinUrl: body.joinUrl,
      format: 'ONLINE',
    });
    expect(m).not.toHaveProperty('meetingProvider');
    expect(m).not.toHaveProperty('externalMeetingId');
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
  });
  it.each(['', 'javascript:alert(1)', 'http://example.test/room'])(
    'rejects unsafe/empty link %s',
    async (joinUrl) => {
      expect((await post('', { ...draft(), format: 'ONLINE', joinUrl })).status).toBe(400);
    },
  );
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
