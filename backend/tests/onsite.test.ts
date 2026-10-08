import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { MemberModel } from '../src/models/member.model.js';
import { MemberService } from '../src/services/member.service.js';
import { MeetingService } from '../src/services/meeting.service.js';
import { MeetingModel } from '../src/models/meeting.model.js';
import { harness, config, memberId } from './support.js';
const attendee = '10000000-0000-4000-8000-000000000002';
const user = {
  id: memberId,
  membership: 'member' as const,
  email: 'sample01@example.test',
  displayName: 'Sample 01',
};
const draft = () => ({
  requestId: '20000000-0000-4000-8000-000000000002',
  title: ' Meeting ',
  candidateName: ' Candidate ',
  candidateEmail: ' CANDIDATE+S1@EXAMPLE.TEST ',
  position: ' Engineer ',
  startsAt: '2026-10-09T09:00:00+07:00',
  endsAt: '2026-10-09T10:00:00+07:00',
  attendeeMemberIds: [attendee],
});
const stored = {
  id: '30000000-0000-4000-8000-000000000002',
  creatorId: memberId,
  title: 'Original',
  description: null,
  preparationNotes: null,
  candidate: { name: 'Candidate', email: 'candidate+s1@example.test' },
  position: 'Engineer',
  startsAt: '2026-10-09T02:00:00.000Z',
  endsAt: '2026-10-09T03:00:00.000Z',
  status: 'PENDING' as const,
  format: 'ONSITE' as const,
  location: null,
  meetingProvider: null,
  externalMeetingId: null,
  attendees: [{ memberId: attendee, displayName: 'Sample 02', email: 'sample02@example.test' }],
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
};
function meetingHarness() {
  const model = {
    findById: vi.fn().mockResolvedValue(stored),
    findByRequestId: vi.fn().mockResolvedValue(null),
    getOwnNote: vi.fn(),
    saveOwnNote: vi.fn(),
    readFeedback: vi.fn(),
    createFeedback: vi.fn(),
    editFeedback: vi.fn(),
    deleteMeeting: vi.fn(),
    mutate: vi.fn(),
    findSummary: vi.fn(),
    readSnapshot: vi.fn(),
    create: vi.fn().mockResolvedValue({ created: true, meeting: stored }),
  };
  return { model, service: new MeetingService(model, () => new Date('2026-10-08T03:00:00Z')) };
}
describe('S1 TEST-MM-013/028 member page unit', () => {
  const model = () => ({ readPage: vi.fn().mockResolvedValue({ items: [], total: 0 }) });
  it.each([undefined, '', '  '])('empty %s avoids database access', async (query) => {
    const m = model();
    expect(await new MemberService(m).searchMembers(query, 1, 20)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(m.readPage).not.toHaveBeenCalled();
  });
  it.each([['a'], {}, 7, null])('rejects nonstring query %j', async (query) => {
    await expect(new MemberService(model()).searchMembers(query, 1, 20)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { query: 'ข้อมูลไม่ถูกต้อง' },
    });
  });
  it('normalizes search and requests a bounded offset page', async () => {
    const m = model();
    m.readPage.mockResolvedValue({ items: [], total: 25 });
    expect(await new MemberService(m).searchMembers(' SAMPLE ', 2, 20)).toEqual({
      items: [],
      page: 2,
      pageSize: 20,
      total: 25,
    });
    expect(m.readPage).toHaveBeenCalledWith('sample', 20, 20);
  });
  it.each([0, -1, 1.5, NaN, Infinity, '2', [], Number.MAX_SAFE_INTEGER])(
    'rejects invalid or unsafe page %j before database access',
    async (page) => {
      const m = model();
      await expect(new MemberService(m).searchMembers('a', page, 20)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
      expect(m.readPage).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.5, 21, '20', null])('rejects invalid pageSize %j', async (size) => {
    await expect(new MemberService(model()).searchMembers('a', 1, size)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });
  it('preserves database errors', async () => {
    const m = model();
    m.readPage.mockRejectedValue(new Error('unavailable'));
    await expect(new MemberService(m).searchMembers('a', 1, 20)).rejects.toThrow('unavailable');
  });
});
describe('member page database boundary', () => {
  it('counts and bounds rows in one consistent transaction with escaped literals', async () => {
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('count(*)') ? [{ total: '25' }] : [],
      })),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    const result = await new MemberModel(pool as never).readPage('%_\\', 20, 20);
    expect(result).toEqual({ items: [], total: 25 });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      expect.stringContaining('count(*)'),
      expect.stringContaining('ORDER BY email, id LIMIT $2 OFFSET $3'),
      'COMMIT',
    ]);
    const calls = client.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[1][1]).toEqual(['%\\%\\_\\\\%']);
    expect(calls[2][1]).toEqual([calls[1][1][0], 20, 20]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('rolls back and reports an unavailable count instead of total zero', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('count failed'));
    await expect(
      new MemberModel({ connect: async () => client } as never).readPage('a', 20, 0),
    ).rejects.toMatchObject({ status: 503 });
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
describe('S1 TEST-MM-014–019 new-operation validation and request-only replay unit', () => {
  it('normalizes required text/email, defaults optional fields, deduplicates and removes creator', async () => {
    const h = meetingHarness();
    await h.service.saveMeeting(user, {
      ...draft(),
      attendeeMemberIds: [memberId, attendee, attendee.toUpperCase()],
    });
    expect(h.model.create).toHaveBeenCalledWith(memberId, {
      ...draft(),
      title: 'Meeting',
      candidateName: 'Candidate',
      candidateEmail: 'candidate+s1@example.test',
      position: 'Engineer',
      description: null,
      preparationNotes: null,
      location: null,
      status: 'PENDING',
      format: 'ONSITE',
      attendeeMemberIds: [attendee],
    });
  });
  it.each(['description', 'location'])(
    'optional %s preserves nonblank content, normalizes blank',
    async (field) => {
      for (const value of [undefined, null, '', ' \t ', '  เนื้อหา\n ']) {
        const h = meetingHarness();
        await h.service.saveMeeting(user, { ...draft(), [field]: value });
        expect(h.model.create.mock.calls[0][1][field]).toBe(value?.trim() ? value : null);
      }
    },
  );
  it.each([
    'title',
    'candidateName',
    'candidateEmail',
    'position',
    'startsAt',
    'endsAt',
    'requestId',
    'attendeeMemberIds',
  ])('required %s missing does not write', async (field) => {
    const h = meetingHarness();
    const data: Record<string, unknown> = draft();
    delete data[field];
    await expect(h.service.saveMeeting(user, data)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(h.model.create).not.toHaveBeenCalled();
  });
  it.each([
    { title: ' ' },
    { candidateEmail: 'bad' },
    { attendeeMemberIds: 'bad' },
    { attendeeMemberIds: ['bad'] },
    { attendeeMemberIds: [] },
    { attendeeMemberIds: [memberId] },
    { creatorId: attendee },
    { authorId: attendee },
    { meetingProvider: 'ZOOM' },
    { unknown: 1 },
    { format: null },
    { format: 7 },
    { status: null },
    { status: 'CANCELLED' },
  ])('rejects invalid new data %j', async (delta) => {
    const h = meetingHarness();
    await expect(h.service.saveMeeting(user, { ...draft(), ...delta })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(h.model.create).not.toHaveBeenCalled();
  });
  it('requires a manual link for ONLINE creation', async () => {
    await expect(
      meetingHarness().service.saveMeeting(user, { ...draft(), format: 'ONLINE' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: { joinUrl: 'ข้อมูลไม่ถูกต้อง' } });
  });
  it.each(['PENDING', 'CONFIRMED', 'REJECTED'])('accepts selected status %s', async (status) => {
    const h = meetingHarness();
    await h.service.saveMeeting(user, { ...draft(), status });
    expect(h.model.create.mock.calls[0][1].status).toBe(status);
  });
  it.each([
    ['2026-02-30T09:00:00+07:00', '2026-03-01T10:00:00+07:00'],
    ['2026-10-09T09:00:00', '2026-10-09T10:00:00'],
    ['bad', '2026-10-09T10:00:00Z'],
    ['2026-10-09T09:00+07:00', '2026-10-09T10:00+07:00'],
    ['2026-10-09T09:00:00+07:00', '2026-10-09T09:00:00+07:00'],
    ['2026-10-09T09:00:00+07:00', '2026-10-09T08:00:00+07:00'],
    ['2026-10-09T09:00:00+07:00', '2026-10-09T02:00:00Z'],
  ])('rejects invalid dates and equal/reverse instants %s → %s', async (startsAt, endsAt) => {
    await expect(
      meetingHarness().service.saveMeeting(user, { ...draft(), startsAt, endsAt }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    ['2026-10-08T02:00:00Z', '2026-10-08T04:00:00Z'],
    ['2026-10-09T23:00:00+07:00', '2026-10-10T01:00:00+07:00'],
    ['2026-10-09T09:00:00+07:00', '2026-10-09T03:00:00Z'],
    ['2026-10-09T00:00:00+07:00', '2026-10-09T23:59:59+07:00'],
  ])('allows earlier today, future offset and cross-day intervals %s', async (startsAt, endsAt) => {
    expect(
      (await meetingHarness().service.saveMeeting(user, { ...draft(), startsAt, endsAt })).created,
    ).toBe(true);
  });
  it.each([
    {},
    { title: null, attendeeMemberIds: 'wrong' },
    { format: 'ONLINE', creatorId: attendee, unknown: 1 },
  ])('existing request ignores invalid/missing business fields %j', async (delta) => {
    const h = meetingHarness();
    h.model.findByRequestId.mockResolvedValue(stored);
    expect(await h.service.saveMeeting(user, { requestId: draft().requestId, ...delta })).toEqual({
      created: false,
      meeting: stored,
    });
    expect(h.model.create).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, 'string', { requestId: 'bad' }])(
    'invalid envelope never reaches replay %j',
    async (body) => {
      const h = meetingHarness();
      await expect(h.service.saveMeeting(user, body)).rejects.toMatchObject({ status: 400 });
      expect(h.model.findByRequestId).not.toHaveBeenCalled();
    },
  );
  it('missing meeting remains404 for a Member', async () => {
    const h = meetingHarness();
    h.model.findById.mockResolvedValue(null);
    await expect(h.service.findMeeting(user, stored.id)).rejects.toMatchObject({
      code: 'MEETING_NOT_FOUND',
    });
    expect(h.model.findById).toHaveBeenCalledWith(memberId, stored.id);
  });
});
describe('S1-DV-01 / TEST-MM-016 representable fractional instant ordering', () => {
  it.each([
    ['2026-10-09T09:00:00.0001+07:00', '2026-10-09T09:00:00.0002+07:00'],
    ['2026-10-09T09:00:00.123456+07:00', '2026-10-09T09:00:00.123457+07:00'],
    ['2026-10-09T09:00:00.123456000+07:00', '2026-10-09T09:00:00.123457000+07:00'],
    ['2026-10-09T09:00:00.120000+07:00', '2026-10-09T09:00:00.120001+07:00'],
    ['2026-10-09T09:00:00+07:00', '2026-10-09T09:00:00.000001+07:00'],
    ['2026-10-09T09:00:00.0001+07:00', '2026-10-09T02:00:00.0002Z'],
    ['2026-10-09T23:59:59.999998+07:00', '2026-10-09T16:59:59.999999Z'],
    ['2026-10-09T23:59:59.999999+07:00', '2026-10-09T17:00:00.000000Z'],
    ['2026-10-09T09:00:00.999999+07:00', '2026-10-09T09:00:01.000000+07:00'],
  ])(
    'preserves positive exact interval %s → %s without rewriting SQL inputs',
    async (startsAt, endsAt) => {
      const h = meetingHarness();
      await h.service.saveMeeting(user, { ...draft(), startsAt, endsAt });
      expect(h.model.create.mock.calls[0][1]).toMatchObject({ startsAt, endsAt });
    },
  );
  it.each([
    ['2026-10-09T09:00:00.0002+07:00', '2026-10-09T09:00:00.0001+07:00'],
    ['2026-10-09T09:00:00.123456+07:00', '2026-10-09T09:00:00.123456000+07:00'],
    ['2026-10-09T09:00:00.0001+07:00', '2026-10-09T02:00:00.000100Z'],
    ['2026-10-09T09:00:01.000000+07:00', '2026-10-09T09:00:00.999999+07:00'],
  ])('rejects equal/reverse exact instants %s → %s', async (startsAt, endsAt) => {
    const h = meetingHarness();
    await expect(
      h.service.saveMeeting(user, { ...draft(), startsAt, endsAt }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      fields: { endsAt: expect.any(String) },
    });
    expect(h.model.create).not.toHaveBeenCalled();
  });
  it.each([
    ['000100', '0001'],
    ['123456', '123456'],
    ['123400', '1234'],
    ['120000', '120'],
    ['000000', '000'],
  ])('model formats stored %s fraction losslessly with min3 digits', async (fraction, expected) => {
    const raw = '2026-10-09T02:00:00.' + fraction + 'Z';
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...stored, startsAt: raw, endsAt: raw, createdAt: raw, updatedAt: raw }],
    });
    const result = await new MeetingModel({ query } as never).findById(memberId, stored.id);
    for (const field of ['startsAt', 'endsAt', 'createdAt', 'updatedAt'] as const)
      expect(result![field]).toBe('2026-10-09T02:00:00.' + expected + 'Z');
    expect(query.mock.calls[0][0]).toContain("AT TIME ZONE 'UTC'");
  });
});
describe('S1 TEST-MM-020 model fault handling (mocked pg client, not real DB)', () => {
  it.each(['members', 'attendees', 'readback', 'commit'])(
    'fault at %s releases same client and maps safely',
    async (fault) => {
      const commands: string[] = [];
      const client = {
        query: vi.fn(async (sql: string) => {
          commands.push(sql);
          if (
            (fault === 'members' && sql.startsWith('SELECT id,')) ||
            (fault === 'attendees' && sql.startsWith('INSERT INTO meeting_attendees')) ||
            (fault === 'readback' &&
              sql.startsWith('SELECT m.id') &&
              commands.some((c) => c.startsWith('INSERT INTO meetings'))) ||
            (fault === 'commit' && sql === 'COMMIT')
          )
            throw new Error('private SQL detail');
          if (sql.startsWith('SELECT id,'))
            return {
              rows: [{ id: attendee, email: 'sample02@example.test', display_name: 'Sample 02' }],
            };
          if (sql.startsWith('INSERT INTO meetings')) return { rows: [{ id: stored.id }] };
          if (
            sql.startsWith('SELECT m.id') &&
            !commands.some((c) => c.startsWith('INSERT INTO meetings'))
          )
            return { rows: [] };
          if (sql.startsWith('SELECT m.id'))
            return {
              rows: [
                {
                  ...stored,
                  startsAt: stored.startsAt,
                  endsAt: stored.endsAt,
                  createdAt: stored.createdAt,
                  updatedAt: stored.updatedAt,
                },
              ],
            };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };
      const h = meetingHarness();
      await h.service.saveMeeting(user, draft());
      const model = new MeetingModel(pool as never);
      await expect(model.create(memberId, h.model.create.mock.calls[0][1])).rejects.toMatchObject({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      expect(client.release).toHaveBeenCalledWith(fault === 'commit');
      expect(commands.includes('ROLLBACK')).toBe(fault !== 'commit');
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
});
describe('S1 TEST-MM-022/027/041 HTTP identity and envelope', () => {
  it('validates page query strictly before invoking the member model', async () => {
    const h = await harness();
    const token = await h.tokens.issue({ authMethod: 'password', subject: memberId });
    const get = (query: string) =>
      request(h.app)
        .get('/api/v1/members?query=sample&' + query)
        .set('Cookie', 'mm_access=' + token.token);
    for (const query of [
      'page=0&pageSize=20',
      'page=-1&pageSize=20',
      'page=1.5&pageSize=20',
      'page=1e2&pageSize=20',
      'page=01&pageSize=20',
      'page=1&page=2&pageSize=20',
      'page=1&pageSize=0',
      'page=1&pageSize=21',
      'page=9007199254740991&pageSize=20',
      'pageSize=20',
      'page=1',
      'page=1&pageSize=20&cursor=old',
    ]) {
      expect((await get(query)).status).toBe(400);
    }
    const invalidQuery = await get('query=duplicate&page=1&pageSize=20');
    expect(invalidQuery.status).toBe(400);
    expect(invalidQuery.body.error.fields).toEqual({ query: 'ข้อมูลไม่ถูกต้อง' });
    expect(h.memberModel.readPage).not.toHaveBeenCalled();
    const response = await get('page=2&pageSize=20');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], page: 2, pageSize: 20, total: 0 });
    expect(h.memberModel.readPage).toHaveBeenCalledWith('sample', 20, 20);
  });
  it('all routes check current Candidate before business service, including replay', async () => {
    const h = await harness(),
      token = await h.tokens.issue({ authMethod: 'password', subject: memberId });
    h.candidates.add(user.email);
    for (const [method, path] of [
      ['get', '/members?query=sample'],
      ['get', '/meetings/' + stored.id],
      ['post', '/meetings'],
    ] as const) {
      let r = request(h.app)
        [method]('/api/v1' + path)
        .set('Cookie', 'mm_access=' + token.token)
        .set('Origin', config.allowedOrigin)
        .set('X-Requested-With', 'MeetingManager');
      if (method === 'post') r = r.send(draft());
      expect((await r).status).toBe(403);
    }
    expect(h.memberModel.readPage).not.toHaveBeenCalled();
    expect(h.meetingModel.findByRequestId).not.toHaveBeenCalled();
  });
  it('missing token and former Google Guest token both deny access with401', async () => {
    const h = await harness();
    expect((await request(h.app).get('/api/v1/members?query=a')).status).toBe(401);
    const token = await h.tokens.issue({
      authMethod: 'google',
      subject: 'google:guest',
      verifiedEmail: 'guest@gmail.com',
    });
    expect(
      (
        await request(h.app)
          .get('/api/v1/members?query=a')
          .set('Cookie', 'mm_access=' + token.token)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(h.app)
          .get('/api/v1/meetings/' + stored.id)
          .set('Cookie', 'mm_access=' + token.token)
      ).status,
    ).toBe(401);
  });
  it('Google current member uses users.id, gives201+Location and forwards errors safely', async () => {
    const h = await harness(),
      token = await h.tokens.issue({
        authMethod: 'google',
        subject: 'google:sample',
        verifiedEmail: user.email,
      });
    h.meetingModel.create.mockResolvedValue({ created: true, meeting: stored });
    const post = () =>
      request(h.app)
        .post('/api/v1/meetings')
        .set('Cookie', 'mm_access=' + token.token)
        .set('Origin', config.allowedOrigin)
        .set('X-Requested-With', 'MeetingManager');
    const r = await post().send(draft());
    expect(r.status).toBe(201);
    expect(r.headers.location).toBe('/api/v1/meetings/' + stored.id);
    expect(h.meetingModel.create.mock.calls[0][0]).toBe(memberId);
    expect(r.headers['cache-control']).toBe('no-store');
    h.meetingModel.findByRequestId.mockResolvedValue(stored as never);
    expect((await post().send({ requestId: draft().requestId })).status).toBe(200);
    expect((await post().type('json').send('{')).status).toBe(400);
    expect(
      (await post().send({ requestId: draft().requestId, extra: 'x'.repeat(17000) })).status,
    ).toBe(400);
  });
});

describe('Confirmed Add temporal and separate-field amendments', () => {
  it.each([
    ['2026-10-07T23:59:59+07:00', '2026-10-08T11:00:00+07:00'],
    ['2026-10-08T09:00:00+07:00', '2026-10-08T10:00:00+07:00'],
    ['2026-10-08T09:00:00+07:00', '2026-10-08T09:59:59.999999+07:00'],
  ])('rejects past date or end <= now %s → %s', async (startsAt, endsAt) => {
    const h = meetingHarness();
    await expect(
      h.service.saveMeeting(user, { ...draft(), startsAt, endsAt }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.model.create).not.toHaveBeenCalled();
  });
  it('accepts end a microsecond after now and validates at one captured instant', async () => {
    const h = meetingHarness();
    const now = vi.fn(() => new Date('2026-10-08T03:00:00.000Z'));
    await new MeetingService(h.model, now).saveMeeting(user, {
      ...draft(),
      startsAt: '2026-10-08T09:00:00+07:00',
      endsAt: '2026-10-08T10:00:00.000001+07:00',
    });
    expect(now).toHaveBeenCalledTimes(1);
  });
  it('uses Bangkok day across UTC midnight and does not validate replay against the new day', async () => {
    const h = meetingHarness();
    const service = new MeetingService(h.model, () => new Date('2026-10-08T17:00:00Z'));
    await expect(
      service.saveMeeting(user, { ...draft(), startsAt: '2026-10-08T23:59:59+07:00' }),
    ).rejects.toMatchObject({ status: 400 });
    h.model.findByRequestId.mockResolvedValue(stored);
    const clock = vi.fn(() => new Date('2030-01-01T00:00:00Z'));
    expect(
      (await new MeetingService(h.model, clock).saveMeeting(user, { requestId: draft().requestId }))
        .meeting,
    ).toEqual(stored);
    expect(clock).not.toHaveBeenCalled();
  });
  it('keeps independent optional values without copying or concatenating', async () => {
    const h = meetingHarness();
    await h.service.saveMeeting(user, {
      ...draft(),
      description: '  general  ',
      preparationNotes: '  prepare\n  ',
    });
    expect(h.model.create.mock.calls[0][1]).toMatchObject({
      description: '  general  ',
      preparationNotes: '  prepare\n  ',
    });
  });
  it.each([7, {}, []])('rejects invalid preparation type %j', async (preparationNotes) => {
    await expect(
      meetingHarness().service.saveMeeting(user, { ...draft(), preparationNotes }),
    ).rejects.toMatchObject({ status: 400, fields: { preparationNotes: expect.any(String) } });
  });
});

describe('meeting edit pre-read scope', () => {
  it.each([
    ['edit', { title: 'Changed' }],
    ['team', { addMemberIds: [attendee], removeEmails: [] }],
    ['cancel', {}],
  ] as const)('delegates %s directly to the guarded mutation', async (operation, change) => {
    const { model, service } = meetingHarness();
    model.mutate.mockResolvedValue(stored);
    expect(
      await service.editMeeting(
        user,
        stored.id,
        { expectedUpdatedAt: stored.updatedAt, ...change },
        operation,
      ),
    ).toEqual({ meeting: stored });
    expect(model.findById).not.toHaveBeenCalled();
    expect(model.mutate).toHaveBeenCalledWith(
      memberId,
      stored.id,
      expect.objectContaining({ expectedUpdatedAt: stored.updatedAt }),
    );
  });
  it.each(['https://example.test/join'])(
    'preserves online format prevalidation for joinUrl %s',
    async (joinUrl) => {
      const { model, service } = meetingHarness();
      await expect(
        service.editMeeting(user, stored.id, { expectedUpdatedAt: stored.updatedAt, joinUrl }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(model.mutate).not.toHaveBeenCalled();
      model.findById.mockResolvedValue(null);
      await expect(
        service.editMeeting(user, stored.id, { expectedUpdatedAt: stored.updatedAt, joinUrl }),
      ).rejects.toMatchObject({ code: 'MEETING_NOT_FOUND', status: 404 });
      model.findById.mockResolvedValue({ ...stored, format: 'ONLINE' } as never);
      model.mutate.mockResolvedValue(stored);
      await service.editMeeting(user, stored.id, { expectedUpdatedAt: stored.updatedAt, joinUrl });
      expect(model.mutate).toHaveBeenCalledWith(memberId, stored.id, {
        expectedUpdatedAt: stored.updatedAt,
        joinUrl,
      });
    },
  );
  it('propagates guarded mutation authorization and stale-version failures without a pre-read', async () => {
    const { model, service } = meetingHarness();
    for (const code of ['MEETING_NOT_FOUND', 'MEETING_CHANGED']) {
      const error = new Error(code);
      model.mutate.mockRejectedValue(error);
      await expect(
        service.editMeeting(user, stored.id, {
          expectedUpdatedAt: stored.updatedAt,
          title: 'Changed',
        }),
      ).rejects.toBe(error);
    }
    expect(model.findById).not.toHaveBeenCalled();
  });
});
