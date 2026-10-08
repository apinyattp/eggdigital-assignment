import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { MeetingModel } from '../models/meeting.model.js';
import type { UserView } from './auth.service.js';
import { ApiError } from '../utils/api-error.js';
import { signSnapshot, verifySnapshot } from '../utils/signed-snapshot.js';
const optionalText = z
  .string()
  .nullable()
  .optional()
  .transform((value) => (value?.trim() ? value : null));
const instant = z.iso
  .datetime({ offset: true })
  .regex(/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
const meetingBody = z
  .object({
    requestId: z.uuid().transform((value) => value.toLowerCase()),
    title: z.string().trim().min(1),
    description: optionalText,
    preparationNotes: optionalText,
    candidateName: z.string().trim().min(1),
    candidateEmail: z.string().trim().toLowerCase().pipe(z.email()),
    position: z.string().trim().min(1),
    startsAt: instant,
    endsAt: instant,
    status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']).default('PENDING'),
    format: z.literal('ONSITE').default('ONSITE'),
    location: optionalText,
    attendeeMemberIds: z.array(z.uuid().transform((value) => value.toLowerCase())),
  })
  .strict();
const manualJoinUrl = z
  .string()
  .trim()
  .pipe(z.url())
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  });
const manualOnlineMeetingBody = meetingBody.extend({
  format: z.literal('ONLINE'),
  joinUrl: manualJoinUrl,
});
const bangkokDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export class MeetingService {
  private mutationLocks = new Map<string, Promise<void>>();
  private async serializedMutation<T>(
    user: UserView,
    meetingId: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    const key =
      (user.id ?? '') + ':' + (typeof meetingId === 'string' ? meetingId.toLowerCase() : 'invalid');
    const previous = this.mutationLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mutationLocks.set(key, pending);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.mutationLocks.get(key) === pending) {
        this.mutationLocks.delete(key);
      }
    }
  }

  constructor(
    private model: Pick<
      MeetingModel,
      | 'findById'
      | 'findByRequestId'
      | 'create'
      | 'mutate'
      | 'findSummary'
      | 'readSnapshot'
      | 'deleteMeeting'
      | 'getOwnNote'
      | 'saveOwnNote'
      | 'readFeedback'
      | 'createFeedback'
      | 'editFeedback'
    >,
    private now: () => Date = () => new Date(),
    private cursorKey: Uint8Array = randomBytes(32),
  ) {}
  async findMeeting(user: UserView, meetingId: unknown) {
    if (!z.uuid().safeParse(meetingId).success)
      throw new ApiError(400, 'VALIDATION_ERROR', { meetingId: 'ข้อมูลไม่ถูกต้อง' });
    if (!user.id || user.membership !== 'member') throw new ApiError(404, 'MEETING_NOT_FOUND');
    const meeting = await this.model.findById(user.id, meetingId as string);
    if (!meeting) throw new ApiError(404, 'MEETING_NOT_FOUND');
    return meeting;
  }
  async findSummary(user: UserView, meetingId: unknown) {
    if (!z.uuid().safeParse(meetingId).success) throw new ApiError(400, 'VALIDATION_ERROR');
    const meeting = await this.model.findSummary(user, meetingId as string);
    if (!meeting) throw new ApiError(404, 'MEETING_NOT_FOUND');
    return meeting;
  }
  async listMeetings(user: UserView, query: unknown) {
    const input = z
      .object({
        date: z.iso.date(),
        section: z.literal('upcomingCurrent').optional(),
        page: z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().positive().safe()),
        pageSize: z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().positive().max(10)),
        snapshot: z.unknown().optional(),
      })
      .strict()
      .safeParse(query);
    if (!input.success) throw new ApiError(400, 'VALIDATION_ERROR');
    const { date, section, page, pageSize } = input.data;
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApiError(400, 'VALIDATION_ERROR');
    if (page > 1 && (!section || input.data.snapshot === undefined))
      throw new ApiError(400, 'INVALID_CURSOR');
    const principal = user.membership + ':' + (user.id ?? '') + ':' + user.email;
    const schema = z
      .object({
        kind: z.literal('meetingList'),
        date: z.iso.date(),
        principal: z.string(),
        pageSize: z.number().int().positive().max(10),
        referenceTime: instant.regex(/Z$/),
        fingerprint: z.string(),
      })
      .strict();
    let previous: z.infer<typeof schema> | undefined;
    if (input.data.snapshot !== undefined) {
      try {
        previous = schema.parse(verifySnapshot(input.data.snapshot, this.cursorKey));
        if (
          previous.date !== date ||
          previous.principal !== principal ||
          previous.pageSize !== pageSize
        )
          throw new Error();
      } catch {
        throw new ApiError(400, 'INVALID_CURSOR');
      }
    }
    const result = await this.model.readSnapshot(
      user,
      date,
      pageSize,
      offset,
      previous?.referenceTime,
      Boolean(section),
    );
    if (previous && previous.fingerprint !== result.fingerprint)
      throw new ApiError(409, 'LIST_CHANGED');
    const snapshot = signSnapshot(
      {
        kind: 'meetingList',
        date,
        principal,
        pageSize,
        referenceTime: result.referenceTime,
        fingerprint: result.fingerprint,
      },
      this.cursorKey,
    );
    const header = {
      date,
      timeZone: 'Asia/Bangkok',
      referenceTime: result.referenceTime,
      snapshot,
    };
    const group = {
      ...result.groups.upcomingCurrent,
      page,
      pageSize,
      totalPages: Math.ceil(result.groups.upcomingCurrent.total / pageSize),
    };
    if (section) return { ...header, section, group };
    return {
      ...header,
      groups: {
        upcomingCurrent: group,
        rejectedCancelled: {
          count: result.groups.rejectedCancelled.total,
          items: result.groups.rejectedCancelled.items,
        },
        past: { count: result.groups.past.total, items: result.groups.past.items },
      },
    };
  }
  private contentIdentity(user: UserView, meetingId: unknown) {
    if (!z.uuid().safeParse(meetingId).success)
      throw new ApiError(400, 'VALIDATION_ERROR', { meetingId: 'ข้อมูลไม่ถูกต้อง' });
    return 'member:' + user.id;
  }
  async getOwnNote(user: UserView, meetingId: unknown, query: unknown = {}) {
    const authorKey = this.contentIdentity(user, meetingId);
    if (!z.object({}).strict().safeParse(query).success)
      throw new ApiError(400, 'VALIDATION_ERROR');
    return this.model.getOwnNote(user, meetingId as string, authorKey);
  }
  async saveOwnNote(user: UserView, meetingId: unknown, body: unknown) {
    const authorKey = this.contentIdentity(user, meetingId);
    const parsed = z
      .object({
        text: z.string(),
        expectedUpdatedAt: instant
          .regex(/Z$/)
          .refine((v) => !/\.\d{7}/.test(v))
          .nullable(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0] ?? 'body'), 'ข้อมูลไม่ถูกต้อง']),
        ),
      );
    return this.model.saveOwnNote(
      user,
      meetingId as string,
      authorKey,
      parsed.data.text,
      parsed.data.expectedUpdatedAt,
    );
  }
  async readFeedback(user: UserView, meetingId: unknown, query: unknown) {
    const authorKey = this.contentIdentity(user, meetingId);
    const parsed = z
      .object({
        page: z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().positive().safe()),
        pageSize: z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .pipe(z.number().int().positive().max(50)),
        snapshot: z.unknown().optional(),
      })
      .strict()
      .safeParse(query);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
    const { page, pageSize } = parsed.data;
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new ApiError(400, 'VALIDATION_ERROR');
    if (page > 1 && parsed.data.snapshot === undefined) throw new ApiError(400, 'INVALID_CURSOR');
    const schema = z
      .object({
        kind: z.literal('feedbackPage'),
        meetingId: z.uuid(),
        principal: z.string(),
        pageSize: z.number().int().positive().max(50),
        asOf: instant.regex(/Z$/),
        total: z.number().int().nonnegative().safe(),
      })
      .strict();
    let previous: z.infer<typeof schema> | undefined;
    if (parsed.data.snapshot !== undefined) {
      try {
        previous = schema.parse(verifySnapshot(parsed.data.snapshot, this.cursorKey));
        if (
          previous.meetingId !== meetingId ||
          previous.principal !== authorKey ||
          previous.pageSize !== pageSize
        )
          throw new Error();
      } catch {
        throw new ApiError(400, 'INVALID_CURSOR');
      }
    }
    const result = await this.model.readFeedback(
      user,
      meetingId as string,
      authorKey,
      pageSize,
      offset,
      previous?.asOf,
    );
    if (previous && result.total !== previous.total) throw new ApiError(409, 'LIST_CHANGED');
    const snapshot = signSnapshot(
      {
        kind: 'feedbackPage',
        meetingId,
        principal: authorKey,
        pageSize,
        asOf: result.asOf,
        total: result.total,
      },
      this.cursorKey,
    );
    return {
      items: result.rows.reverse(),
      ownFeedbackId: result.ownFeedbackId,
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
      asOf: result.asOf,
      snapshot,
    };
  }
  async createFeedback(user: UserView, meetingId: unknown, body: unknown) {
    const authorKey = this.contentIdentity(user, meetingId);
    const envelope = z
      .object({
        requestId: z.uuid().transform((v) => v.toLowerCase()),
        text: z.unknown().optional(),
      })
      .strict()
      .safeParse(body);
    if (!envelope.success)
      throw new ApiError(400, 'VALIDATION_ERROR', { requestId: 'ข้อมูลไม่ถูกต้อง' });
    return this.model.createFeedback(
      user,
      meetingId as string,
      authorKey,
      envelope.data.requestId,
      () => {
        const full = z
          .object({ requestId: z.uuid(), text: z.string().trim().min(1) })
          .strict()
          .safeParse(body);
        if (!full.success)
          throw new ApiError(
            400,
            'VALIDATION_ERROR',
            Object.fromEntries(
              full.error.issues.map((i) => [String(i.path[0] ?? 'body'), 'ข้อมูลไม่ถูกต้อง']),
            ),
          );
        return full.data.text;
      },
    );
  }
  async editFeedback(user: UserView, meetingId: unknown, feedbackId: unknown, body: unknown) {
    const authorKey = this.contentIdentity(user, meetingId);
    if (!z.uuid().safeParse(feedbackId).success)
      throw new ApiError(400, 'VALIDATION_ERROR', { feedbackId: 'ข้อมูลไม่ถูกต้อง' });
    const parsed = z
      .object({
        text: z.string().trim().min(1),
        expectedUpdatedAt: instant.regex(/Z$/).refine((v) => !/\.\d{7}/.test(v)),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0] ?? 'body'), 'ข้อมูลไม่ถูกต้อง']),
        ),
      );
    return this.model.editFeedback(
      user,
      meetingId as string,
      authorKey,
      feedbackId as string,
      parsed.data.text,
      parsed.data.expectedUpdatedAt,
    );
  }
  async deleteMeeting(user: UserView, meetingId: unknown, body: unknown) {
    return this.serializedMutation(user, meetingId, () =>
      this.performDeleteMeeting(user, meetingId, body),
    );
  }
  private async performDeleteMeeting(user: UserView, meetingId: unknown, body: unknown) {
    if (!user.id || user.membership !== 'member') throw new ApiError(404, 'MEETING_NOT_FOUND');
    if (!z.uuid().safeParse(meetingId).success) throw new ApiError(400, 'VALIDATION_ERROR');
    const parsed = z
      .object({ expectedUpdatedAt: instant.regex(/Z$/).refine((value) => !/\.\d{7}/.test(value)) })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR');
    await this.model.deleteMeeting(user.id, meetingId as string, parsed.data.expectedUpdatedAt);
  }

  async editMeeting(
    user: UserView,
    meetingId: unknown,
    body: unknown,
    operation: 'edit' | 'team' | 'cancel' = 'edit',
  ) {
    return this.serializedMutation(user, meetingId, () =>
      this.performEditMeeting(user, meetingId, body, operation),
    );
  }
  private async performEditMeeting(
    user: UserView,
    meetingId: unknown,
    body: unknown,
    operation: 'edit' | 'team' | 'cancel' = 'edit',
  ) {
    if (!user.id || user.membership !== 'member') throw new ApiError(404, 'MEETING_NOT_FOUND');
    if (!z.uuid().safeParse(meetingId).success) throw new ApiError(400, 'VALIDATION_ERROR');
    const version = instant.regex(/Z$/).refine((value) => !/\.\d{7}/.test(value));
    const team = z
      .object({
        addMemberIds: z.array(z.uuid().transform((v) => v.toLowerCase())),
        removeEmails: z.array(z.string().trim().toLowerCase().pipe(z.email())),
      })
      .strict();
    const optionalMutationText = z
      .string()
      .nullable()
      .transform((v) => (v?.trim() ? v : null))
      .optional();
    const base = z.object({ expectedUpdatedAt: version });
    const schema =
      operation === 'cancel'
        ? base.strict()
        : operation === 'team'
          ? base.extend(team.shape).strict()
          : base
              .extend({
                title: z.string().trim().min(1).optional(),
                candidateName: z.string().trim().min(1).optional(),
                candidateEmail: z.string().trim().toLowerCase().pipe(z.email()).optional(),
                position: z.string().trim().min(1).optional(),
                description: optionalMutationText,
                preparationNotes: optionalMutationText,
                location: optionalMutationText,
                joinUrl: manualJoinUrl.optional(),
                status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED']).optional(),
                attendeeChanges: team.optional(),
              })
              .strict();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        if (issue.code === 'unrecognized_keys')
          for (const key of issue.keys) fields[key] = 'ไม่สามารถแก้ไขฟิลด์นี้';
        else fields[String(issue.path[0] ?? 'body')] = 'ข้อมูลไม่ถูกต้อง';
      }
      throw new ApiError(400, 'VALIDATION_ERROR', fields);
    }
    const input = parsed.data as import('../models/meeting.model.js').MeetingMutation & {
      addMemberIds?: string[];
      removeEmails?: string[];
    };
    if (operation === 'cancel') input.status = 'CANCELLED';
    if (operation === 'team') {
      input.attendeeChanges = {
        addMemberIds: input.addMemberIds!,
        removeEmails: input.removeEmails!,
      };
      delete input.addMemberIds;
      delete input.removeEmails;
    }
    if (input.attendeeChanges) {
      input.attendeeChanges.addMemberIds = [...new Set(input.attendeeChanges.addMemberIds)].filter(
        (id) => id !== user.id!.toLowerCase(),
      );
      input.attendeeChanges.removeEmails = [...new Set(input.attendeeChanges.removeEmails)];
    }
    if (input.joinUrl !== undefined) {
      const current = await this.model.findById(user.id, meetingId as string);
      if (!current) throw new ApiError(404, 'MEETING_NOT_FOUND');
      if (current.format !== 'ONLINE') {
        throw new ApiError(400, 'VALIDATION_ERROR', {
          joinUrl: 'ใช้ลิงก์ได้เฉพาะการประชุมออนไลน์',
        });
      }
    }
    return { meeting: await this.model.mutate(user.id, meetingId as string, input) };
  }

  async saveMeeting(user: UserView, body: unknown) {
    if (!user.id || user.membership !== 'member') throw new ApiError(403, 'MEMBER_REQUIRED');
    const envelope = z.object({ requestId: z.uuid() }).safeParse(body);
    if (!envelope.success)
      throw new ApiError(400, 'VALIDATION_ERROR', { requestId: 'ข้อมูลไม่ถูกต้อง' });
    const existing = await this.model.findByRequestId(user.id, envelope.data.requestId);
    if (existing) return { created: false, meeting: existing };
    const online = (body as Record<string, unknown>).format === 'ONLINE';
    const parsed = (online ? manualOnlineMeetingBody : meetingBody).safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        fields[String(issue.path[0] ?? 'body')] = 'ข้อมูลไม่ถูกต้อง';
      throw new ApiError(400, 'VALIDATION_ERROR', fields);
    }
    const input = parsed.data;
    // Compare exact fractional digits; Date is used only for whole-second UTC/zone conversion.
    const fractionPattern = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/;
    const startFraction = input.startsAt.match(fractionPattern)?.[1] ?? '';
    const endFraction = input.endsAt.match(fractionPattern)?.[1] ?? '';
    const starts = new Date(input.startsAt.replace(fractionPattern, ''));
    const ends = new Date(input.endsAt.replace(fractionPattern, ''));
    const fractionLength = Math.max(startFraction.length, endFraction.length);
    const endAfterStart =
      ends.getTime() > starts.getTime() ||
      (ends.getTime() === starts.getTime() &&
        endFraction.padEnd(fractionLength, '0') > startFraction.padEnd(fractionLength, '0'));
    const now = this.now();
    if (bangkokDate.format(starts) < bangkokDate.format(now))
      throw new ApiError(400, 'VALIDATION_ERROR', { startsAt: 'วันที่เริ่มต้องไม่ก่อนวันนี้' });
    const nowWholeSecond = Math.floor(now.getTime() / 1000) * 1000;
    const nowFraction = String(now.getUTCMilliseconds()).padStart(3, '0');
    const nowDigits = Math.max(endFraction.length, nowFraction.length);
    const endAfterNow =
      ends.getTime() > nowWholeSecond ||
      (ends.getTime() === nowWholeSecond &&
        endFraction.padEnd(nowDigits, '0') > nowFraction.padEnd(nowDigits, '0'));
    if (!endAfterStart || !endAfterNow)
      throw new ApiError(400, 'VALIDATION_ERROR', {
        endsAt: 'วันเวลาเลิกต้องหลังเวลาเริ่มและเวลาปัจจุบัน',
      });
    input.attendeeMemberIds = [...new Set(input.attendeeMemberIds)].filter(
      (id) => id !== user.id!.toLowerCase(),
    );
    if (!input.attendeeMemberIds.length)
      throw new ApiError(400, 'VALIDATION_ERROR', {
        attendeeMemberIds: 'เลือกสมาชิกอื่นอย่างน้อยหนึ่งคน',
      });
    return this.model.create(user.id, input);
  }
}
