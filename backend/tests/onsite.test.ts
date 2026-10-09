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
      totalPages: 0,
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
      totalPages: 2,
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
describe('batched attendee writes (mocked pg client, not real DB)', () => {
  const members = Array.from({ length: 30 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
    email: `member${index}@example.test`,
    display_name: `Member ${index}`,
  }));
  function database(current = [] as { email: string; member_id: string }[], replay = false) {
    let created = false;
    const client = {
      query: vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql.startsWith('SELECT id,email,display_name')) return { rows: members };
        if (sql.startsWith('SELECT create_request_id'))
          return { rows: [{ create_request_id: draft().requestId }] };
        if (sql.startsWith('SELECT id, updated_at'))
          return { rows: [{ id: stored.id, matches: true, creator_email: user.email }] };
        if (sql.startsWith('SELECT email,member_id')) return { rows: current };
        if (sql.startsWith('INSERT INTO meetings')) {
          created = true;
          return { rows: [{ id: stored.id }] };
        }
        if (sql.startsWith('SELECT m.id'))
          return {
            rows:
              created || replay || sql.includes('WHERE m.creator_id=$1 AND m.id=$2')
                ? [stored]
                : [],
          };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return { client, pool, model: new MeetingModel(pool as never) };
  }
  it.each(['create', 'mutate'] as const)(
    'inserts a large team with one statement on the transaction client during %s',
    async (operation) => {
      const { client, pool, model } = database();
      const attendeeMemberIds = members.map((member) => member.id);
      if (operation === 'create') {
        await model.create(memberId, {
          ...draft(),
          attendeeMemberIds,
          description: null,
          preparationNotes: null,
          location: null,
          status: 'PENDING',
          format: 'ONSITE',
        });
      } else {
        await model.mutate(memberId, stored.id, {
          expectedUpdatedAt: stored.updatedAt,
          attendeeChanges: { addMemberIds: attendeeMemberIds, removeEmails: [] },
        });
      }
      const inserts = client.query.mock.calls.filter(([sql]) =>
        sql.startsWith('INSERT INTO meeting_attendees'),
      );
      expect(inserts).toHaveLength(1);
      expect(inserts[0][1]).toEqual([
        stored.id,
        members.map((member) => member.email),
        members.map((member) => member.display_name),
        attendeeMemberIds,
      ]);
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledWith(false);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
  it('does not insert or update the version when every added member is already retained', async () => {
    const { model, client } = database(
      members.map((member) => ({ email: member.email, member_id: member.id })),
    );
    await model.mutate(memberId, stored.id, {
      expectedUpdatedAt: stored.updatedAt,
      attendeeChanges: { addMemberIds: members.map((member) => member.id), removeEmails: [] },
    });
    expect(client.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(
      false,
    );
  });
  it('does not write attendees on a create replay', async () => {
    const { model, client } = database([], true);
    const result = await model.create(memberId, {
      ...draft(),
      description: null,
      preparationNotes: null,
      location: null,
      status: 'PENDING',
      format: 'ONSITE',
    });
    expect(result.created).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
  });
});
describe('mutation transaction contracts (mocked pg client, not real DB)', () => {
  const member = { id: attendee, email: 'sample02@example.test', display_name: 'Sample 02' };
  function database(
    options: {
      missing?: 'identity' | 'locked';
      stale?: boolean;
      unknownMember?: boolean;
      fault?: 'readback' | 'commit';
      rollbackFails?: boolean;
    } = {},
  ) {
    const client = {
      query: vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql === 'COMMIT' && options.fault === 'commit')
          throw new Error('private commit detail');
        if (sql === 'ROLLBACK' && options.rollbackFails) throw new Error('private rollback detail');
        if (sql.startsWith('SELECT create_request_id'))
          return {
            rows: options.missing === 'identity' ? [] : [{ create_request_id: draft().requestId }],
          };
        if (sql.startsWith('SELECT id, updated_at'))
          return {
            rows:
              options.missing === 'locked'
                ? []
                : [{ id: stored.id, matches: !options.stale, creator_email: user.email }],
          };
        if (sql.startsWith('SELECT email,member_id')) return { rows: [] };
        if (sql.startsWith('SELECT id,email,display_name'))
          return { rows: options.unknownMember ? [] : [member] };
        if (sql.startsWith('SELECT m.id')) {
          if (options.fault === 'readback') throw new Error('private readback detail');
          return { rows: [stored] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return { client, pool, model: new MeetingModel(pool as never) };
  }
  const change = () => ({
    expectedUpdatedAt: stored.updatedAt,
    attendeeChanges: { addMemberIds: [attendee], removeEmails: [] },
  });
  const writes = (client: ReturnType<typeof database>['client']) =>
    client.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql));

  it('keeps creator checks, advisory lock, row lock, user locks and readback on one client in order', async () => {
    const { client, pool, model } = database();
    expect(await model.mutate(memberId, stored.id, change())).toEqual(stored);
    const calls = client.query.mock.calls;
    expect(calls[0]).toEqual(['BEGIN']);
    expect(calls[1]).toEqual([
      'SELECT create_request_id FROM meetings WHERE creator_id=$1 AND id=$2',
      [memberId, stored.id],
    ]);
    expect(calls[2]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [memberId + ':' + draft().requestId],
    ]);
    expect(calls[3]).toEqual([
      expect.stringContaining('WHERE creator_id=$1 AND id=$2 FOR UPDATE'),
      [memberId, stored.id, stored.updatedAt],
    ]);
    const memberRead = calls.findIndex(([sql]) => sql.startsWith('SELECT id,email,display_name'));
    expect(memberRead).toBeGreaterThan(3);
    expect(calls[memberRead]).toEqual([
      expect.stringContaining('ORDER BY id FOR SHARE'),
      [[attendee]],
    ]);
    expect(calls.at(-2)).toEqual([
      expect.stringContaining('WHERE m.creator_id=$1 AND m.id=$2'),
      [memberId, stored.id],
    ]);
    expect(calls.at(-1)).toEqual(['COMMIT']);
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(['identity', 'locked'] as const)(
    'returns creator-scoped404 when %s disappears before any writes',
    async (missing) => {
      const { client, model } = database({ missing });
      await expect(model.mutate(memberId, stored.id, change())).rejects.toMatchObject({
        status: 404,
        code: 'MEETING_NOT_FOUND',
      });
      expect(writes(client)).toEqual([]);
      expect(
        client.query.mock.calls.some(([sql]) => sql.startsWith('SELECT email,member_id')),
      ).toBe(false);
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it('rejects a stale version before treating an empty mutation as a no-op', async () => {
    const { client, model } = database({ stale: true });
    await expect(
      model.mutate(memberId, stored.id, { expectedUpdatedAt: stored.updatedAt }),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_MEETING' });
    expect(writes(client)).toEqual([]);
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith('SELECT m.id'))).toBe(false);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('advances the version for an attendee-only change without inventing detail updates', async () => {
    const { client, model } = database();
    await model.mutate(memberId, stored.id, change());
    const updates = client.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE meetings'));
    expect(updates).toHaveLength(1);
    expect(updates[0]![0]).toContain(
      "updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')",
    );
    expect(updates[0]![0]).toContain('WHERE id=$1 AND (true)');
    expect(updates[0]![0]).not.toMatch(/title=|description=|status=/);
    expect(updates[0]![1]).toEqual([stored.id]);
  });

  it.each([false, true])(
    'preserves validation error and rolls back before detail/team writes (rollback failure=%s)',
    async (rollbackFails) => {
      const { client, model } = database({ unknownMember: true, rollbackFails });
      await expect(
        model.mutate(memberId, stored.id, { ...change(), title: 'Must not persist' }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: { addMemberIds: expect.any(String) },
      });
      expect(writes(client)).toEqual([]);
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(rollbackFails);
    },
  );

  it.each(['readback', 'commit'] as const)(
    'maps %s failure without leaking details and discards only ambiguous commit',
    async (fault) => {
      const { client, pool, model } = database({ fault });
      const mutation = model.mutate(memberId, stored.id, change());
      await expect(mutation).rejects.toMatchObject({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      await expect(mutation).rejects.not.toThrow('private');
      expect(writes(client).length).toBeGreaterThan(0);
      expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(fault !== 'commit');
      expect(client.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(
        fault === 'commit' ? 1 : 0,
      );
      expect(client.release).toHaveBeenCalledExactlyOnceWith(fault === 'commit');
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
});
describe('create and delete transaction stages (mocked pg client, not real DB)', () => {
  const input = () => ({
    ...draft(),
    description: 'Description',
    preparationNotes: 'Preparation',
    location: null,
    status: 'PENDING' as const,
    format: 'ONLINE' as const,
    joinUrl: 'https://meet.example.test/room',
  });
  it.each([true, false])(
    'preserves create parameters and winner readback (inserted=%s)',
    async (inserted) => {
      let reads = 0;
      const client = {
        query: vi.fn(async (sql: string, _values?: unknown[]) => {
          if (sql.startsWith('SELECT m.id')) return { rows: reads++ ? [stored] : [] };
          if (sql.startsWith('SELECT id,email,display_name'))
            return {
              rows: [{ id: attendee, email: 'sample02@example.test', display_name: 'Sample 02' }],
            };
          if (sql.startsWith('INSERT INTO meetings'))
            return { rows: inserted ? [{ id: stored.id }] : [] };
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      const pool = { connect: vi.fn(async () => client), query: vi.fn() };
      const payload = input();
      expect(await new MeetingModel(pool as never).create(memberId, payload)).toEqual({
        created: inserted,
        meeting: stored,
      });
      const calls = client.query.mock.calls;
      expect(calls[0]).toEqual(['BEGIN ISOLATION LEVEL READ COMMITTED']);
      expect(calls[1]).toEqual([
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [memberId + ':' + payload.requestId],
      ]);
      expect(calls[2][0]).toContain('deleted_meeting_requests');
      expect(calls[2][1]).toEqual([memberId, payload.requestId]);
      expect(calls[3]).toEqual([
        'SELECT id,email,display_name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [[attendee]],
      ]);
      expect(calls[4][0]).toContain(
        'ON CONFLICT (creator_id,create_request_id) DO NOTHING RETURNING id',
      );
      expect(calls[4][1]).toEqual([
        expect.stringMatching(/^[0-9a-f-]{36}$/),
        memberId,
        payload.requestId,
        payload.title,
        payload.description,
        payload.candidateName,
        payload.candidateEmail,
        payload.position,
        payload.startsAt,
        payload.endsAt,
        payload.status,
        payload.format,
        payload.location,
        payload.preparationNotes,
        payload.joinUrl,
      ]);
      const attendeeWrites = calls.filter(([sql]) =>
        sql.startsWith('INSERT INTO meeting_attendees'),
      );
      expect(attendeeWrites).toHaveLength(inserted ? 1 : 0);
      expect(calls.at(-2)).toEqual([calls[2][0], [memberId, payload.requestId]]);
      expect(calls.at(-1)).toEqual(['COMMIT']);
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(pool.query).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    },
  );
  it('rejects a terminal deleted create key before validating or inserting attendees', async () => {
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.startsWith('SELECT m.id') ? [{ deleted: true }] : [],
      })),
      release: vi.fn(),
    };
    await expect(
      new MeetingModel({ connect: async () => client } as never).create(memberId, input()),
    ).rejects.toMatchObject({ status: 410, code: 'MEETING_DELETED' });
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => /^(INSERT|SELECT id,email)/.test(sql))).toBe(
      false,
    );
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  function deletion(
    options: {
      absent?: 'identity' | 'locked';
      stale?: boolean;
      fault?: 'receipt' | 'attendees' | 'parent' | 'commit';
      rollbackFails?: boolean;
    } = {},
  ) {
    const client = {
      query: vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql === 'ROLLBACK' && options.rollbackFails) throw new Error('private rollback');
        if (
          (options.fault === 'receipt' && sql.startsWith('INSERT INTO deleted_meeting_requests')) ||
          (options.fault === 'attendees' && sql.startsWith('DELETE FROM meeting_attendees')) ||
          (options.fault === 'parent' && sql.startsWith('DELETE FROM meetings ')) ||
          (options.fault === 'commit' && sql === 'COMMIT')
        )
          throw new Error('private SQL');
        if (sql.startsWith('SELECT create_request_id'))
          return {
            rows: options.absent === 'identity' ? [] : [{ create_request_id: draft().requestId }],
          };
        if (sql.startsWith('SELECT updated_at='))
          return { rows: options.absent === 'locked' ? [] : [{ matches: !options.stale }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return { client, pool, model: new MeetingModel(pool as never) };
  }
  it('deletes using creator identity, operation lock, version lock, receipt then child/parent order', async () => {
    const { client, pool, model } = deletion();
    await model.deleteMeeting(memberId, stored.id, stored.updatedAt);
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      [
        'SELECT create_request_id FROM meetings WHERE creator_id=$1 AND id=$2',
        [memberId, stored.id],
      ],
      [
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [memberId + ':' + draft().requestId],
      ],
      [
        'SELECT updated_at=$3::timestamptz AS matches FROM meetings WHERE creator_id=$1 AND id=$2 FOR UPDATE',
        [memberId, stored.id, stored.updatedAt],
      ],
      [
        'INSERT INTO deleted_meeting_requests(creator_id,create_request_id,meeting_id) VALUES($1,$2,$3)',
        [memberId, draft().requestId, stored.id],
      ],
      ['DELETE FROM meeting_attendees WHERE meeting_id=$1', [stored.id]],
      ['DELETE FROM meetings WHERE id=$1 AND creator_id=$2', [stored.id, memberId]],
      ['COMMIT'],
    ]);
    expect(pool.connect).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(['identity', 'locked', 'stale'] as const)(
    'rejects delete %s before receipt or row writes',
    async (stage) => {
      const { client, model } = deletion(stage === 'stale' ? { stale: true } : { absent: stage });
      await expect(
        model.deleteMeeting(memberId, stored.id, stored.updatedAt),
      ).rejects.toMatchObject({
        status: stage === 'stale' ? 409 : 404,
        code: stage === 'stale' ? 'STALE_MEETING' : 'MEETING_NOT_FOUND',
      });
      expect(client.query.mock.calls.some(([sql]) => /^(INSERT|DELETE)/.test(sql))).toBe(false);
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    },
  );
  it.each([
    ['receipt', false],
    ['attendees', false],
    ['parent', false],
    ['parent', true],
    ['commit', false],
  ] as const)(
    'preserves delete failure handling at %s (rollback fails=%s)',
    async (fault, rollbackFails) => {
      const { client, model } = deletion({ fault, rollbackFails });
      const result = model.deleteMeeting(memberId, stored.id, stored.updatedAt);
      await expect(result).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      await expect(result).rejects.not.toThrow('private');
      expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(fault !== 'commit');
      expect(client.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(
        fault === 'commit' ? 1 : 0,
      );
      expect(client.release).toHaveBeenCalledExactlyOnceWith(fault === 'commit' || rollbackFails);
    },
  );
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
    expect(response.body).toEqual({ items: [], page: 2, pageSize: 20, total: 0, totalPages: 0 });
    expect(h.memberModel.readPage).toHaveBeenCalledWith('sample', 20, 20);
    h.memberModel.readPage.mockResolvedValue({ items: [], total: 25 });
    const smaller = await get('page=2&pageSize=5');
    expect(smaller.status).toBe(200);
    expect(smaller.body).toEqual({ items: [], page: 2, pageSize: 5, total: 25, totalPages: 5 });
    expect(h.memberModel.readPage).toHaveBeenLastCalledWith('sample', 5, 5);
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

describe('Own-note save query contracts (mocked pg client, not real DB)', () => {
  const authorKey = 'member:' + user.id;
  const version = '2026-10-08T03:00:00.000001Z';
  const text = '  private\n  ';
  function database(
    options: {
      existing?: { content: string; matches: boolean | null };
      text?: string;
      missingMeeting?: boolean;
      denied?: boolean;
      fault?: 'version' | 'insert' | 'update' | 'readback' | 'commit';
      rollbackFails?: boolean;
    } = {},
  ) {
    const note = { text: options.text ?? text, updatedAt: version };
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql === 'ROLLBACK' && options.rollbackFails) throw new Error('private rollback detail');
      if (
        (options.fault === 'version' && sql.startsWith('SELECT content,updated_at=')) ||
        (options.fault === 'insert' && sql.startsWith('INSERT INTO interview_notes')) ||
        (options.fault === 'update' && sql.startsWith('UPDATE interview_notes')) ||
        (options.fault === 'readback' && sql.startsWith('SELECT content AS text')) ||
        (options.fault === 'commit' && sql === 'COMMIT')
      )
        throw new Error('private SQL detail');
      if (sql.startsWith('SELECT id FROM meetings'))
        return { rows: options.missingMeeting ? [] : [{ id: stored.id }] };
      if (sql.startsWith('SELECT m.id FROM meetings'))
        return { rows: options.denied ? [] : [{ id: stored.id }] };
      if (sql.startsWith('SELECT content,updated_at='))
        return { rows: options.existing ? [options.existing] : [] };
      if (sql.startsWith('SELECT content AS text')) return { rows: [note] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn() };
    return { model: new MeetingModel(pool as never), pool, client, note };
  }
  it.each([
    { name: 'new empty note', content: '', existing: undefined, expected: null, write: 'INSERT' },
    {
      name: 'changed verbatim note',
      content: text,
      existing: { content: 'Before', matches: true },
      expected: version,
      write: 'UPDATE',
    },
    {
      name: 'same-content null-version retry',
      content: text,
      existing: { content: text, matches: null },
      expected: null,
      write: null,
    },
    {
      name: 'same-content stale-version retry',
      content: text,
      existing: { content: text, matches: false },
      expected: version,
      write: null,
    },
  ])(
    'preserves ordered author-scoped queries for $name',
    async ({ content, existing, expected, write }) => {
      const { model, pool, client, note } = database({ existing, text: content });
      expect(await model.saveOwnNote(user, stored.id, authorKey, content, expected)).toBe(note);
      const calls = client.query.mock.calls;
      expect(calls[0]).toEqual(['BEGIN']);
      expect(calls[1]).toEqual(['SELECT id FROM meetings WHERE id=$1 FOR UPDATE', [stored.id]]);
      expect(calls[2][0]).toContain('m.creator_id=$1 OR EXISTS');
      expect(calls[2][0]).toContain('(a.member_id=$1 OR (a.member_id IS NULL AND a.email=$2))');
      expect(calls[2][1]).toEqual([user.id, user.email, stored.id]);
      expect(calls[3]).toEqual([
        'SELECT content,updated_at=$3::timestamptz AS matches FROM interview_notes WHERE meeting_id=$1 AND author_key=$2',
        [stored.id, authorKey, expected],
      ]);
      const writes = calls.filter(([sql]) => /^(INSERT|UPDATE)/.test(sql));
      expect(writes).toHaveLength(write ? 1 : 0);
      if (write) {
        expect(calls[4]).toBe(writes[0]);
        expect(writes[0][0]).toMatch(new RegExp('^' + write + '.*interview_notes'));
        expect(writes[0][1]).toEqual([stored.id, authorKey, content]);
        if (write === 'UPDATE')
          expect(writes[0][0]).toContain(
            "updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')",
          );
      }
      const readback = calls[write ? 5 : 4];
      expect(readback[0]).toContain('SELECT content AS text,to_char(updated_at');
      expect(readback[0]).toContain('WHERE meeting_id=$1 AND author_key=$2');
      expect(readback[1]).toEqual([stored.id, authorKey]);
      expect(calls).toHaveLength(write ? 7 : 6);
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    {
      name: 'missing meeting',
      options: { missingMeeting: true },
      expected: null,
      status: 404,
      code: 'MEETING_NOT_FOUND',
      calls: 3,
    },
    {
      name: 'permission lost after parent lock',
      options: { denied: true },
      expected: null,
      status: 404,
      code: 'MEETING_NOT_FOUND',
      calls: 4,
    },
    {
      name: 'missing note with non-null version',
      options: {},
      expected: version,
      status: 409,
      code: 'NOTE_CHANGED',
      calls: 5,
    },
    {
      name: 'different content with stale version',
      options: { existing: { content: 'Before', matches: false } },
      expected: version,
      status: 409,
      code: 'NOTE_CHANGED',
      calls: 5,
    },
  ])(
    'stops before note writes/readback for $name',
    async ({ options, expected, status, code, calls }) => {
      const { model, pool, client } = database(options);
      await expect(
        model.saveOwnNote(user, stored.id, authorKey, text, expected),
      ).rejects.toMatchObject({ status, code });
      expect(client.query).toHaveBeenCalledTimes(calls);
      expect(
        client.query.mock.calls.some(([sql]) =>
          /^(INSERT|UPDATE|SELECT content AS text)/.test(sql),
        ),
      ).toBe(false);
      expect(client.query).not.toHaveBeenCalledWith('COMMIT');
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['version', false],
    ['insert', false],
    ['update', false],
    ['readback', false],
    ['commit', false],
    ['version', true],
  ] as const)(
    'maps %s failure and preserves client cleanup (rollback failure=%s)',
    async (fault, rollbackFails) => {
      const existing = fault === 'update' ? { content: 'Before', matches: true } : undefined;
      const { model, pool, client } = database({ existing, fault, rollbackFails });
      const result = model.saveOwnNote(user, stored.id, authorKey, text, existing ? version : null);
      await expect(result).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      await expect(result).rejects.not.toThrow('private');
      expect(client.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(
        fault === 'commit' ? 1 : 0,
      );
      expect(client.query.mock.calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(
        fault === 'commit' ? 0 : 1,
      );
      expect(client.release).toHaveBeenCalledExactlyOnceWith(fault === 'commit' || rollbackFails);
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
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

describe('member page count metadata', () => {
  it.each([0, 1, 25])('derives totalPages from the same SQL count for total %s', async (total) => {
    const model = { readPage: vi.fn().mockResolvedValue({ items: [], total }) };
    const service = new MemberService(model);
    for (const size of [1, 5, 20]) {
      for (const page of [1, 99]) {
        expect(await service.searchMembers(' member ', page, size)).toEqual({
          items: [],
          total,
          page,
          pageSize: size,
          totalPages: Math.ceil(total / size),
        });
        expect(model.readPage).toHaveBeenLastCalledWith('member', size, (page - 1) * size);
      }
    }
  });
});

describe('feedback write transaction contracts (mocked pg client)', () => {
  const authorKey = 'member:' + user.id;
  const feedbackId = '40000000-0000-4000-8000-000000000002';
  const requestId = draft().requestId;
  const feedback = {
    id: feedbackId,
    text: 'Saved',
    author: { displayName: user.displayName },
    isOwn: true,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
  function database(
    options: {
      denied?: boolean;
      request?: string;
      content?: string;
      missing?: boolean;
      stale?: boolean;
      fault?: 'readback' | 'commit';
    } = {},
  ) {
    const client = {
      query: vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql === 'COMMIT' && options.fault === 'commit')
          throw new Error('private commit detail');
        if (sql.startsWith('SELECT id FROM meetings')) return { rows: [{ id: stored.id }] };
        if (sql.startsWith('SELECT m.id FROM meetings'))
          return { rows: options.denied ? [] : [{ id: stored.id }] };
        if (sql.startsWith('SELECT id,create_request_id'))
          return {
            rows: options.request ? [{ id: feedbackId, create_request_id: options.request }] : [],
          };
        if (sql.startsWith('SELECT content,updated_at'))
          return {
            rows: options.missing
              ? []
              : [{ content: options.content ?? 'Saved', matches: !options.stale }],
          };
        if (sql.startsWith('SELECT id,content AS text')) {
          if (options.fault === 'readback') throw new Error('private readback detail');
          return { rows: [feedback] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client), query: vi.fn() };
    return { client, pool, model: new MeetingModel(pool as never) };
  }
  it.each(['create', 'edit'] as const)(
    'rechecks access after the parent lock before %s feedback lookup',
    async (operation) => {
      const { model, client, pool } = database({ denied: true });
      const validate = vi.fn(() => 'New');
      const result =
        operation === 'create'
          ? model.createFeedback(user, stored.id, authorKey, requestId, validate)
          : model.editFeedback(user, stored.id, authorKey, feedbackId, 'New', stored.updatedAt);
      await expect(result).rejects.toMatchObject({ status: 404, code: 'MEETING_NOT_FOUND' });
      expect(client.query.mock.calls).toEqual([
        ['BEGIN'],
        ['SELECT id FROM meetings WHERE id=$1 FOR UPDATE', [stored.id]],
        [expect.stringContaining('WHERE m.id=$3 AND'), [user.id, user.email, stored.id]],
        ['ROLLBACK'],
      ]);
      expect(validate).not.toHaveBeenCalled();
      expect(pool.query).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    },
  );
  it.each([requestId, 'different-request'])(
    'decides existing request %s before content validation',
    async (existingRequest) => {
      const { model, client } = database({ request: existingRequest });
      const validate = vi.fn(() => {
        throw new Error('must never validate replay');
      });
      const result = model.createFeedback(user, stored.id, authorKey, requestId, validate);
      if (existingRequest === requestId) {
        await expect(result).resolves.toEqual({ created: false, feedback });
        expect(client.query.mock.calls.at(-2)).toEqual([
          expect.stringContaining('WHERE meeting_id=$1 AND id=$3'),
          [stored.id, authorKey, feedbackId],
        ]);
        expect(client.query).toHaveBeenLastCalledWith('COMMIT');
      } else {
        await expect(result).rejects.toMatchObject({ status: 409, code: 'FEEDBACK_EXISTS' });
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      }
      expect(validate).not.toHaveBeenCalled();
      expect(client.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    },
  );
  it('validates new content after replay lookup and inserts its author snapshot on the same client', async () => {
    const { model, client, pool } = database();
    const validate = vi.fn(() => {
      expect(client.query).toHaveBeenLastCalledWith(
        'SELECT id,create_request_id FROM meeting_feedback WHERE meeting_id=$1 AND author_key=$2',
        [stored.id, authorKey],
      );
      return 'New feedback';
    });
    await expect(
      model.createFeedback(user, stored.id, authorKey, requestId, validate),
    ).resolves.toEqual({ created: true, feedback });
    const insert = client.query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO meeting_feedback'),
    )!;
    expect(insert[1]).toEqual([
      expect.any(String),
      stored.id,
      authorKey,
      user.displayName,
      requestId,
      'New feedback',
    ]);
    expect(client.query.mock.calls.at(-2)![1]).toEqual([stored.id, authorKey, insert[1]![0]]);
    expect(validate).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });
  it.each(['', 'Saved'])(
    'same content %j remains a no-op even with a stale version',
    async (text) => {
      const { model, client } = database({ content: text, stale: true });
      await expect(
        model.editFeedback(user, stored.id, authorKey, feedbackId, text, stored.updatedAt),
      ).resolves.toEqual(feedback);
      expect(client.query.mock.calls[3]).toEqual([
        expect.stringContaining('WHERE meeting_id=$1 AND author_key=$2 AND id=$3'),
        [stored.id, authorKey, feedbackId, stored.updatedAt],
      ]);
      expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
      expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    },
  );
  it.each([true, false])(
    'rejects missing=%s feedback or changed-content stale version without updates',
    async (missing) => {
      const { model, client } = database({ missing, stale: true });
      await expect(
        model.editFeedback(user, stored.id, authorKey, feedbackId, 'Changed', stored.updatedAt),
      ).rejects.toMatchObject({
        status: missing ? 404 : 409,
        code: missing ? 'FEEDBACK_NOT_FOUND' : 'FEEDBACK_CHANGED',
      });
      expect(
        client.query.mock.calls.some(
          ([sql]) => sql.startsWith('UPDATE') || sql.startsWith('SELECT id,content AS text'),
        ),
      ).toBe(false);
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
    },
  );
  it('updates changed content with a monotonic version and author-scoped parameters', async () => {
    const { model, client } = database();
    await model.editFeedback(user, stored.id, authorKey, feedbackId, 'Changed', stored.updatedAt);
    expect(client.query.mock.calls[4]).toEqual([
      "UPDATE meeting_feedback SET content=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE meeting_id=$1 AND author_key=$2 AND id=$3",
      [stored.id, authorKey, feedbackId, 'Changed'],
    ]);
    expect(client.query.mock.calls.at(-2)![1]).toEqual([stored.id, authorKey, feedbackId]);
  });
  it.each(['create-readback', 'create-commit', 'edit-readback', 'edit-commit'] as const)(
    'preserves rollback/discard handling for %s failure',
    async (stage) => {
      const fault = stage.endsWith('commit') ? 'commit' : 'readback';
      const { model, client, pool } = database({ fault });
      const result = stage.startsWith('create')
        ? model.createFeedback(user, stored.id, authorKey, requestId, () => 'New')
        : model.editFeedback(user, stored.id, authorKey, feedbackId, 'Changed', stored.updatedAt);
      await expect(result).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
      await expect(result).rejects.not.toThrow('private');
      expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(fault !== 'commit');
      expect(client.release).toHaveBeenCalledExactlyOnceWith(fault === 'commit');
      expect(pool.query).not.toHaveBeenCalled();
    },
  );
});
