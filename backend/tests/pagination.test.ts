import { createHmac } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { signSnapshot, verifySnapshot } from '../src/utils/signed-snapshot.js';
import { MeetingService } from '../src/services/meeting.service.js';
const attendee = '10000000-0000-4000-8000-000000000002';
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  membership: 'member' as const,
  email: 'sample01@example.test',
  displayName: 'Sample 01',
};
const stored = { id: '30000000-0000-4000-8000-000000000002' };
function meetingHarness(key?: Uint8Array) {
  const model = {
    findById: vi.fn(),
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
    create: vi.fn(),
  };
  return { model, service: new MeetingService(model, () => new Date('2026-10-08T03:00:00Z'), key) };
}
describe('page metadata validation and snapshot binding', () => {
  const current = {
    referenceTime: '2026-10-08T03:00:00.000000Z',
    fingerprint: 'same',
    groups: {
      upcomingCurrent: { total: 17, items: [] },
      rejectedCancelled: { total: 0, items: [] },
      past: { total: 0, items: [] },
    },
  };
  it('preserves existing token bytes and accepts pre-extraction list and feedback tokens', async () => {
    const key = Buffer.alloc(32, 7);
    const h = meetingHarness(key);
    const listData = {
      kind: 'meetingList',
      date: '2026-10-08',
      principal: 'member:' + user.id + ':' + user.email,
      pageSize: 10,
      referenceTime: current.referenceTime,
      fingerprint: current.fingerprint,
    };
    const feedbackData = {
      kind: 'feedbackPage',
      meetingId: stored.id,
      principal: 'member:' + user.id,
      pageSize: 50,
      asOf: current.referenceTime,
      total: 55,
    };
    // Construct the previous wire format independently of the extracted codec.
    const legacyToken = (data: unknown) => {
      const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
      return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
    };
    h.model.readSnapshot.mockResolvedValue(current);
    h.model.readFeedback.mockResolvedValue({
      rows: [],
      ownFeedbackId: null,
      total: 55,
      asOf: current.referenceTime,
    });
    expect(
      (
        await h.service.listMeetings(user, {
          date: '2026-10-08',
          section: 'upcomingCurrent',
          page: '2',
          pageSize: '10',
          snapshot: legacyToken(listData),
        })
      ).snapshot,
    ).toBe(legacyToken(listData));
    expect(
      (
        await h.service.readFeedback(user, stored.id, {
          page: '2',
          pageSize: '50',
          snapshot: legacyToken(feedbackData),
        })
      ).snapshot,
    ).toBe(legacyToken(feedbackData));
  });
  it('rejects tokens for another purpose and tokens from a restarted service before database reads', async () => {
    const h = meetingHarness();
    h.model.readSnapshot.mockResolvedValue(current);
    h.model.readFeedback.mockResolvedValue({
      rows: [],
      ownFeedbackId: null,
      total: 55,
      asOf: current.referenceTime,
    });
    const list = await h.service.listMeetings(user, {
      date: '2026-10-08',
      page: '1',
      pageSize: '10',
    });
    const feedback = await h.service.readFeedback(user, stored.id, { page: '1', pageSize: '50' });
    h.model.readSnapshot.mockClear();
    h.model.readFeedback.mockClear();
    const restarted = new MeetingService(h.model);
    for (const [service, listToken, feedbackToken] of [
      [h.service, feedback.snapshot, list.snapshot],
      [restarted, list.snapshot, feedback.snapshot],
    ] as const) {
      await expect(
        service.listMeetings(user, {
          date: '2026-10-08',
          page: '1',
          pageSize: '10',
          snapshot: listToken,
        }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
      await expect(
        service.readFeedback(user, stored.id, {
          page: '1',
          pageSize: '50',
          snapshot: feedbackToken,
        }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    }
    expect(h.model.readSnapshot).not.toHaveBeenCalled();
    expect(h.model.readFeedback).not.toHaveBeenCalled();
  });
  it('binds list snapshots to the date and complete principal before database reads', async () => {
    const h = meetingHarness();
    h.model.readSnapshot.mockResolvedValue(current);
    const first = await h.service.listMeetings(user, {
      date: '2026-10-08',
      page: '1',
      pageSize: '10',
    });
    h.model.readSnapshot.mockClear();
    for (const [principal, date] of [
      [user, '2026-10-09'],
      [{ ...user, id: attendee }, '2026-10-08'],
      [{ ...user, email: 'changed@example.test' }, '2026-10-08'],
    ] as const) {
      await expect(
        h.service.listMeetings(principal, {
          date,
          page: '1',
          pageSize: '10',
          snapshot: first.snapshot,
        }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    }
    expect(h.model.readSnapshot).not.toHaveBeenCalled();
  });
  it('rejects correctly signed but invalid purpose-specific schemas', async () => {
    const key = Buffer.alloc(32, 7);
    const h = meetingHarness(key);
    await expect(
      h.service.listMeetings(user, {
        date: '2026-10-08',
        page: '1',
        pageSize: '10',
        snapshot: signSnapshot(
          {
            kind: 'meetingList',
            date: '2026-10-08',
            principal: 'member:' + user.id + ':' + user.email,
            pageSize: 50,
            referenceTime: current.referenceTime,
            fingerprint: 'same',
          },
          key,
        ),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    await expect(
      h.service.readFeedback(user, stored.id, {
        page: '1',
        pageSize: '50',
        snapshot: signSnapshot(
          {
            kind: 'feedbackPage',
            meetingId: stored.id,
            principal: 'member:' + user.id,
            pageSize: 50,
            asOf: current.referenceTime,
            total: 55,
            extra: true,
          },
          key,
        ),
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    expect(h.model.readSnapshot).not.toHaveBeenCalled();
    expect(h.model.readFeedback).not.toHaveBeenCalled();
  });
  it('uses numeric offsets independently of signed list snapshot position', async () => {
    const h = meetingHarness();
    h.model.readSnapshot.mockResolvedValue(current);
    const first = await h.service.listMeetings(user, {
      date: '2026-10-08',
      page: '1',
      pageSize: '10',
    });
    const next = await h.service.listMeetings(user, {
      date: '2026-10-08',
      section: 'upcomingCurrent',
      page: '2',
      pageSize: '10',
      snapshot: first.snapshot,
    });
    expect(next).toMatchObject({
      referenceTime: current.referenceTime,
      group: { page: 2, pageSize: 10, total: 17 },
    });
    expect(h.model.readSnapshot).toHaveBeenLastCalledWith(
      user,
      '2026-10-08',
      10,
      10,
      current.referenceTime,
      true,
    );
    h.model.readSnapshot.mockResolvedValue({ ...current, fingerprint: 'changed' });
    await expect(
      h.service.listMeetings(user, {
        date: '2026-10-08',
        section: 'upcomingCurrent',
        page: '2',
        pageSize: '10',
        snapshot: first.snapshot,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'LIST_CHANGED' });
  });
  it.each(['0', '-1', '1.1', '01', '1e2', '9007199254740991'])(
    'rejects invalid page %s before list database access',
    async (page) => {
      const h = meetingHarness();
      await expect(
        h.service.listMeetings(user, { date: '2026-10-08', page, pageSize: '10' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(h.model.readSnapshot).not.toHaveBeenCalled();
    },
  );
  it('requires snapshot metadata for later pages', async () => {
    const h = meetingHarness();
    await expect(
      h.service.listMeetings(user, {
        date: '2026-10-08',
        section: 'upcomingCurrent',
        page: '2',
        pageSize: '10',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(
      h.service.readFeedback(user, stored.id, { page: '2', pageSize: '50' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it.each([null, [], {}, '', 'bad', 'payload.signature.extra', 'x'.repeat(4097)])(
    'rejects malformed snapshot %j before database access',
    async (snapshot) => {
      const h = meetingHarness();
      await expect(
        h.service.listMeetings(user, { date: '2026-10-08', page: '1', pageSize: '10', snapshot }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
      await expect(
        h.service.readFeedback(user, stored.id, { page: '1', pageSize: '50', snapshot }),
      ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
      expect(h.model.readSnapshot).not.toHaveBeenCalled();
      expect(h.model.readFeedback).not.toHaveBeenCalled();
    },
  );
  it('binds feedback metadata and rejects changed eligible counts', async () => {
    const h = meetingHarness();
    const asOf = '2026-10-08T03:00:00.000001Z';
    h.model.readFeedback.mockResolvedValue({ rows: [], ownFeedbackId: null, total: 55, asOf });
    const first = await h.service.readFeedback(user, stored.id, { page: '1', pageSize: '50' });
    expect(first).toMatchObject({ page: 1, pageSize: 50, total: 55, asOf });
    await h.service.readFeedback(user, stored.id, {
      page: '2',
      pageSize: '50',
      snapshot: first.snapshot,
    });
    expect(h.model.readFeedback).toHaveBeenLastCalledWith(
      user,
      stored.id,
      'member:' + user.id,
      50,
      50,
      asOf,
    );
    await expect(
      h.service.readFeedback({ ...user, id: attendee }, stored.id, {
        page: '2',
        pageSize: '50',
        snapshot: first.snapshot,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    await expect(
      h.service.readFeedback(user, attendee, {
        page: '2',
        pageSize: '50',
        snapshot: first.snapshot,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    h.model.readFeedback.mockResolvedValue({ rows: [], ownFeedbackId: null, total: 56, asOf });
    await expect(
      h.service.readFeedback(user, stored.id, {
        page: '2',
        pageSize: '50',
        snapshot: first.snapshot,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'LIST_CHANGED' });
  });
});

describe('SQL page query boundaries', () => {
  it('returns database counts and bounded section rows using one transaction', async () => {
    const { MeetingModel } = await import('../src/models/meeting.model.js');
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('transaction_timestamp')
          ? [{ time: '2026-10-08T03:00:00.000000Z' }]
          : sql.includes('WITH scoped')
            ? [
                {
                  current_total: '17',
                  rejected_total: '9',
                  past_total: '11',
                  fingerprint: 'digest',
                },
              ]
            : [],
      })),
      release: vi.fn(),
    };
    const result = await new MeetingModel({ connect: async () => client } as never).readSnapshot(
      user,
      '2026-10-08',
      10,
      10,
      '2026-10-08T03:00:00.000000Z',
      true,
    );
    expect(result.groups.upcomingCurrent).toEqual({ total: 17, items: [] });
    expect(client.query.mock.calls).toHaveLength(5);
    const rowsCall = client.query.mock.calls[3] as unknown as [string, unknown[]];
    expect(rowsCall[0]).toContain('ORDER BY m.starts_at,m.id LIMIT $5 OFFSET $6');
    expect(rowsCall[1]).toEqual([
      user.id,
      user.email,
      '2026-10-08',
      '2026-10-08T03:00:00.000000Z',
      10,
      10,
    ]);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('uses the same meeting and asOf filter after Member access for feedback count and rows', async () => {
    const { MeetingModel } = await import('../src/models/meeting.model.js');
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes('SELECT m.id')
          ? [{ id: stored.id }]
          : sql.includes('count(*)')
            ? [{ total: '1' }]
            : [],
      })),
      release: vi.fn(),
    };
    const asOf = '2026-10-08T03:00:00.000001Z';
    const result = await new MeetingModel({ connect: async () => client } as never).readFeedback(
      user,
      stored.id,
      'member:' + user.id,
      50,
      50,
      asOf,
    );
    expect(result).toMatchObject({ total: 1, asOf, rows: [] });
    const calls = client.query.mock.calls as unknown as [string, unknown[]][];
    expect(calls[3][0]).toContain('meeting_id=$1 AND created_at <= $2::timestamptz');
    expect(calls[4][0]).toContain('meeting_id=$1 AND created_at <= $3::timestamptz');
    expect(calls[3][1]).toEqual([stored.id, asOf]);
    expect(calls[4][1]).toEqual([stored.id, 'member:' + user.id, asOf, 50, 50]);
    expect(calls[4][0]).toContain('LIMIT $4 OFFSET $5');
  });
});

describe('signed snapshot wire validation', () => {
  const key = Buffer.alloc(32, 7);
  it('rejects payload tampering, signature tampering and wrong-length signatures', () => {
    const [payload, signature] = signSnapshot({ value: 'original' }, key).split('.');
    const changedPayload = Buffer.from(JSON.stringify({ value: 'changed' })).toString('base64url');
    const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    for (const token of [
      changedPayload + '.' + signature,
      payload + '.' + changedSignature,
      payload + '.AA',
    ]) {
      expect(() => verifySnapshot(token, key)).toThrow();
    }
  });
  it('rejects noncanonical signature aliases, padding and extra segments', () => {
    const token = signSnapshot({ value: 'original' }, key);
    const [payload, signature] = token.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alias = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)!) + 1];
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    for (const invalid of [
      payload + '.' + alias,
      token + '=',
      token + '.extra',
      payload + '=.' + signature,
    ]) {
      expect(() => verifySnapshot(invalid, key)).toThrow();
    }
  });
  it('rejects correctly signed payloads that are not JSON', () => {
    const payload = Buffer.from('not JSON').toString('base64url');
    const token = payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
    expect(() => verifySnapshot(token, key)).toThrow();
  });
});
