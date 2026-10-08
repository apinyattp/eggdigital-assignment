import type { Pool, PoolClient } from 'pg';
import type { UserView } from '../services/auth.service.js';
import { randomUUID } from 'node:crypto';
import { ApiError, unavailable } from '../utils/api-error.js';
export type NewMeeting = {
  requestId: string;
  title: string;
  description: string | null;
  preparationNotes: string | null;
  candidateName: string;
  candidateEmail: string;
  position: string;
  startsAt: string;
  endsAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  format: 'ONSITE' | 'ONLINE';
  location: string | null;
  attendeeMemberIds: string[];
  joinUrl?: string;
};
export type MeetingView = {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  preparationNotes: string | null;
  candidate: { name: string; email: string };
  position: string;
  startsAt: string;
  endsAt: string;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  format: 'ONSITE' | 'ONLINE';
  location: string | null;
  meetingProvider: 'GOOGLE_MEET' | 'ZOOM' | null;
  externalMeetingId: string | null;
  joinUrl?: string | null;
  attendees: { memberId: string | null; displayName: string; email: string }[];
  createdAt: string;
  updatedAt: string;
};
export type MeetingMutation = {
  expectedUpdatedAt: string;
  title?: string;
  description?: string | null;
  preparationNotes?: string | null;
  candidateName?: string;
  candidateEmail?: string;
  position?: string;
  location?: string | null;
  joinUrl?: string;
  status?: MeetingView['status'];
  attendeeChanges?: { addMemberIds: string[]; removeEmails: string[] };
};
const meetingProjection = `SELECT m.id, m.creator_id AS "creatorId", m.title, m.description, m.preparation_notes AS "preparationNotes",
         json_build_object('name',m.candidate_name,'email',m.candidate_email) AS candidate,
         m.position, to_char(m.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startsAt", to_char(m.ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "endsAt", m.status, m.format,
         m.location, m.meeting_provider AS "meetingProvider", m.external_meeting_id AS "externalMeetingId",
         to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt", to_char(m.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
         COALESCE((SELECT json_agg(json_build_object('memberId',a.member_id,'displayName',a.display_name,'email',a.email)
           ORDER BY a.email,a.member_id) FROM (
             SELECT DISTINCT ON (member_id, CASE WHEN member_id IS NULL THEN email END)
               member_id,display_name,email FROM meeting_attendees
             WHERE meeting_id=m.id AND CASE WHEN member_id IS NOT NULL THEN member_id<>m.creator_id
               ELSE email<>(SELECT email FROM users WHERE id=m.creator_id) END
             ORDER BY member_id, CASE WHEN member_id IS NULL THEN email END, email
           ) a),'[]') AS attendees
`;
export type NoteView = { text: string; updatedAt: string };
export type FeedbackView = {
  id: string;
  text: string;
  author: { displayName: string };
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
};
const feedbackProjection = `SELECT id,content AS text,json_build_object('displayName',author_name) AS author,
  author_key=$2 AS "isOwn",to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM meeting_feedback`;
export class MeetingModel {
  constructor(private pool: Pool) {}
  private get projection() {
    // Retain read-only access to stored historical links; no provider clients or mutations.
    const join = `CASE WHEN m.format='ONLINE' AND m.status<>'CANCELLED'
      THEN COALESCE(m.manual_join_url,
        CASE WHEN NOT EXISTS(SELECT 1 FROM meeting_provider_cleanup c WHERE c.meeting_id=m.id)
        THEN (SELECT o.join_url FROM meeting_provider_operations o WHERE o.creator_id=m.creator_id
          AND o.request_id=m.create_request_id AND o.phase='COMPLETED') ELSE NULL END)
      ELSE NULL END`;
    return meetingProjection + ', ' + join + ' AS "joinUrl"';
  }
  async findById(creatorId: string, meetingId: string): Promise<MeetingView | null> {
    return this.find('id', creatorId, meetingId);
  }
  async findByRequestId(creatorId: string, requestId: string): Promise<MeetingView | null> {
    return this.find('create_request_id', creatorId, requestId);
  }
  async create(
    creatorId: string,
    input: NewMeeting,
  ): Promise<{ created: boolean; meeting: MeetingView }> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false;
    let discardClient = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Serialize the same operation key with Delete before observing its outcome.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        creatorId + ':' + input.requestId,
      ]);
      const existing = await this.find('create_request_id', creatorId, input.requestId, client);
      if (existing) {
        commitStarted = true;
        await client.query('COMMIT');
        return { created: false, meeting: existing };
      }

      const members = (
        await client.query<{ id: string; email: string; display_name: string }>(
          'SELECT id,email,display_name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
          [input.attendeeMemberIds],
        )
      ).rows;
      if (members.length !== input.attendeeMemberIds.length)
        throw new ApiError(400, 'VALIDATION_ERROR', { attendeeMemberIds: 'ไม่พบสมาชิกที่เลือก' });
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO meetings (id,creator_id,create_request_id,title,description,candidate_name,candidate_email,position,starts_at,ends_at,status,format,location,preparation_notes,meeting_provider,external_meeting_id,manual_join_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (creator_id,create_request_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          creatorId,
          input.requestId,
          input.title,
          input.description,
          input.candidateName,
          input.candidateEmail,
          input.position,
          input.startsAt,
          input.endsAt,
          input.status,
          input.format,
          input.location,
          input.preparationNotes,
          null,
          null,
          input.joinUrl ?? null,
        ],
      );
      const created = inserted.rows.length === 1;
      if (created) {
        for (const member of members)
          await client.query(
            'INSERT INTO meeting_attendees (meeting_id,email,display_name,member_id) VALUES ($1,$2,$3,$4)',
            [inserted.rows[0]!.id, member.email, member.display_name, member.id],
          );
      }
      // The next READ COMMITTED statement sees a concurrent committed winner.
      const meeting = await this.find('create_request_id', creatorId, input.requestId, client);
      if (!meeting) throw unavailable();
      commitStarted = true;
      await client.query('COMMIT');
      return { created, meeting };
    } catch (error) {
      if (commitStarted) {
        // A lost COMMIT acknowledgement has an unknown outcome; retry the same request ID.
        discardClient = true;
      } else {
        try {
          await client.query('ROLLBACK');
        } catch {
          discardClient = true;
        }
      }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discardClient);
    }
  }
  async deleteMeeting(
    creatorId: string,
    meetingId: string,
    expectedUpdatedAt: string,
  ): Promise<void> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false;
    let discard = false;
    try {
      await client.query('BEGIN');
      // Read identity first, then take operation-key -> row locks in the same order as create.
      const found = (
        await client.query<{ create_request_id: string }>(
          'SELECT create_request_id FROM meetings WHERE creator_id=$1 AND id=$2',
          [creatorId, meetingId],
        )
      ).rows[0];
      if (!found) throw new ApiError(404, 'MEETING_NOT_FOUND');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        creatorId + ':' + found.create_request_id,
      ]);
      const locked = (
        await client.query(
          'SELECT updated_at=$3::timestamptz AS matches FROM meetings WHERE creator_id=$1 AND id=$2 FOR UPDATE',
          [creatorId, meetingId, expectedUpdatedAt],
        )
      ).rows[0];
      if (!locked) throw new ApiError(404, 'MEETING_NOT_FOUND');
      if (!locked.matches) throw new ApiError(409, 'STALE_MEETING');
      await client.query(
        'INSERT INTO deleted_meeting_requests(creator_id,create_request_id,meeting_id) VALUES($1,$2,$3)',
        [creatorId, found.create_request_id, meetingId],
      );
      await client.query('DELETE FROM meeting_attendees WHERE meeting_id=$1', [meetingId]);
      await client.query('DELETE FROM meetings WHERE id=$1 AND creator_id=$2', [
        meetingId,
        creatorId,
      ]);
      commitStarted = true;
      await client.query('COMMIT');
    } catch (error) {
      if (commitStarted) discard = true;
      else
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  async getOwnNote(user: UserView, meetingId: string, authorKey: string): Promise<NoteView | null> {
    try {
      const row = (
        await this.pool.query(
          `SELECT n.content AS text,to_char(n.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt"
         FROM meetings m LEFT JOIN interview_notes n ON n.meeting_id=m.id AND n.author_key=$4
         WHERE m.id=$3 AND ${this.readPredicate()}`,
          [user.id, user.email, meetingId, authorKey],
        )
      ).rows[0];
      if (!row) throw new ApiError(404, 'MEETING_NOT_FOUND');
      return row.updatedAt === null ? null : row;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
  private async lockContentMeeting(client: PoolClient, user: UserView, meetingId: string) {
    const locked = await client.query('SELECT id FROM meetings WHERE id=$1 FOR UPDATE', [
      meetingId,
    ]);
    if (!locked.rows.length) throw new ApiError(404, 'MEETING_NOT_FOUND');
    // A waiting statement may have observed the old team; recheck after acquiring the parent lock.
    const allowed = await client.query(
      `SELECT m.id FROM meetings m WHERE m.id=$3 AND ${this.readPredicate()}`,
      [user.id, user.email, meetingId],
    );
    if (!allowed.rows.length) throw new ApiError(404, 'MEETING_NOT_FOUND');
  }
  async saveOwnNote(
    user: UserView,
    meetingId: string,
    authorKey: string,
    text: string,
    expectedUpdatedAt: string | null,
  ): Promise<NoteView> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false,
      discard = false;
    try {
      await client.query('BEGIN');
      await this.lockContentMeeting(client, user, meetingId);
      const existing = (
        await client.query(
          `SELECT content,updated_at=$3::timestamptz AS matches FROM interview_notes WHERE meeting_id=$1 AND author_key=$2`,
          [meetingId, authorKey, expectedUpdatedAt],
        )
      ).rows[0];
      if (!existing) {
        if (expectedUpdatedAt !== null) throw new ApiError(409, 'NOTE_CHANGED');
        await client.query(
          'INSERT INTO interview_notes(meeting_id,author_key,content) VALUES($1,$2,$3)',
          [meetingId, authorKey, text],
        );
      } else if (existing.content !== text) {
        if (!existing.matches) throw new ApiError(409, 'NOTE_CHANGED');
        await client.query(
          "UPDATE interview_notes SET content=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE meeting_id=$1 AND author_key=$2",
          [meetingId, authorKey, text],
        );
      }
      const note = (
        await client.query<NoteView>(
          `SELECT content AS text,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt" FROM interview_notes WHERE meeting_id=$1 AND author_key=$2`,
          [meetingId, authorKey],
        )
      ).rows[0]!;
      commitStarted = true;
      await client.query('COMMIT');
      return note;
    } catch (error) {
      if (commitStarted) discard = true;
      else
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  async readFeedback(
    user: UserView,
    meetingId: string,
    authorKey: string,
    pageSize: number,
    offset: number,
    previousAsOf?: string,
  ) {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const access = await client.query(
        `SELECT m.id FROM meetings m WHERE m.id=$3 AND ${this.readPredicate()}`,
        [user.id, user.email, meetingId],
      );
      if (!access.rows.length) throw new ApiError(404, 'MEETING_NOT_FOUND');
      const own = (
        await client.query<{ id: string }>(
          'SELECT id FROM meeting_feedback WHERE meeting_id=$1 AND author_key=$2',
          [meetingId, authorKey],
        )
      ).rows[0];
      const asOf =
        previousAsOf ??
        ((
          await client.query(
            `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time`,
          )
        ).rows[0].time as string);
      const visibility = `meeting_id=$1 AND created_at <= $3::timestamptz`;
      const parameters = [meetingId, authorKey, asOf];
      const total = Number(
        (
          await client.query(
            `SELECT count(*) AS total FROM meeting_feedback WHERE meeting_id=$1 AND created_at <= $2::timestamptz`,
            [meetingId, asOf],
          )
        ).rows[0].total,
      );
      const rows = (
        await client.query<FeedbackView>(
          `${feedbackProjection} WHERE ${visibility} ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
          [...parameters, pageSize, offset],
        )
      ).rows;
      await client.query('COMMIT');
      return { rows, ownFeedbackId: own?.id ?? null, total, asOf };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  async createFeedback(
    user: UserView,
    meetingId: string,
    authorKey: string,
    requestId: string,
    validateNewContent: () => string,
  ) {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false,
      discard = false;
    try {
      await client.query('BEGIN');
      await this.lockContentMeeting(client, user, meetingId);
      const own = (
        await client.query<{ id: string; create_request_id: string }>(
          'SELECT id,create_request_id FROM meeting_feedback WHERE meeting_id=$1 AND author_key=$2',
          [meetingId, authorKey],
        )
      ).rows[0];
      let id: string,
        created = false;
      if (own) {
        if (own.create_request_id !== requestId) throw new ApiError(409, 'FEEDBACK_EXISTS');
        id = own.id;
      } else {
        // Service validation is deferred until the serialized replay/existence decision.
        const text = validateNewContent();
        id = randomUUID();
        created = true;
        await client.query(
          'INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content) VALUES($1,$2,$3,$4,$5,$6)',
          [id, meetingId, authorKey, user.displayName, requestId, text],
        );
      }
      const feedback = (
        await client.query<FeedbackView>(`${feedbackProjection} WHERE meeting_id=$1 AND id=$3`, [
          meetingId,
          authorKey,
          id,
        ])
      ).rows[0]!;
      commitStarted = true;
      await client.query('COMMIT');
      return { created, feedback };
    } catch (error) {
      if (commitStarted) discard = true;
      else
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  async editFeedback(
    user: UserView,
    meetingId: string,
    authorKey: string,
    feedbackId: string,
    text: string,
    expectedUpdatedAt: string,
  ): Promise<FeedbackView> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false,
      discard = false;
    try {
      await client.query('BEGIN');
      await this.lockContentMeeting(client, user, meetingId);
      const own = (
        await client.query(
          `SELECT content,updated_at=$4::timestamptz AS matches FROM meeting_feedback WHERE meeting_id=$1 AND author_key=$2 AND id=$3`,
          [meetingId, authorKey, feedbackId, expectedUpdatedAt],
        )
      ).rows[0];
      if (!own) throw new ApiError(404, 'FEEDBACK_NOT_FOUND');
      if (own.content !== text) {
        if (!own.matches) throw new ApiError(409, 'FEEDBACK_CHANGED');
        await client.query(
          "UPDATE meeting_feedback SET content=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond') WHERE meeting_id=$1 AND author_key=$2 AND id=$3",
          [meetingId, authorKey, feedbackId, text],
        );
      }
      const feedback = (
        await client.query<FeedbackView>(`${feedbackProjection} WHERE meeting_id=$1 AND id=$3`, [
          meetingId,
          authorKey,
          feedbackId,
        ])
      ).rows[0]!;
      commitStarted = true;
      await client.query('COMMIT');
      return feedback;
    } catch (error) {
      if (commitStarted) discard = true;
      else
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  async findSummary(user: UserView, meetingId: string) {
    try {
      const result = await this.pool.query(
        `${this.projection}, json_build_object('id',u.id,'displayName',u.display_name) AS organizer
         FROM meetings m JOIN users u ON u.id=m.creator_id
         WHERE m.id=$3 AND ${this.readPredicate()}`,
        [user.id, user.email, meetingId],
      );
      const row = result.rows[0];
      return row ? this.coreView(row) : null;
    } catch {
      throw unavailable();
    }
  }
  async readSnapshot(
    user: UserView,
    date: string,
    pageSize: number,
    offset: number,
    previousReferenceTime?: string,
    currentOnly = false,
  ) {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const currentTime = (
        await client.query(
          `SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time`,
        )
      ).rows[0].time as string;
      const referenceTime = previousReferenceTime ?? currentTime;
      const scope = `${this.readPredicate()}
        AND m.starts_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Bangkok')
        AND m.starts_at < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')`;
      // PostgreSQL returns only counts and one digest for change detection, never the full dataset.
      // Current-time grouping in the digest detects meetings crossing their end boundary.
      const evidence = (
        await client.query(
          `WITH scoped AS (
          ${this.projection}, json_build_object('id',u.id,'displayName',u.display_name) AS organizer,
          CASE WHEN m.status IN ('REJECTED','CANCELLED') THEN 'rejectedCancelled'
            WHEN m.ends_at > $4::timestamptz THEN 'upcomingCurrent' ELSE 'past' END AS section
          FROM meetings m JOIN users u ON u.id=m.creator_id WHERE ${scope}
        ) SELECT count(*) FILTER (WHERE section='upcomingCurrent') AS current_total,
          count(*) FILTER (WHERE section='rejectedCancelled') AS rejected_total,
          count(*) FILTER (WHERE section='past') AS past_total,
          md5(COALESCE(string_agg(row_to_json(scoped)::text, '' ORDER BY id),'')) AS fingerprint FROM scoped`,
          [user.id, user.email, date, currentTime],
        )
      ).rows[0];
      const upcoming = (
        await client.query(
          `${this.projection}, json_build_object('id',u.id,'displayName',u.display_name) AS organizer
          FROM meetings m JOIN users u ON u.id=m.creator_id WHERE ${scope}
          AND m.status NOT IN ('REJECTED','CANCELLED') AND m.ends_at > $4::timestamptz
          ORDER BY m.starts_at,m.id LIMIT $5 OFFSET $6`,
          [user.id, user.email, date, referenceTime, pageSize, offset],
        )
      ).rows;
      const rejected = currentOnly
        ? []
        : (
            await client.query(
              `${this.projection}, json_build_object('id',u.id,'displayName',u.display_name) AS organizer
          FROM meetings m JOIN users u ON u.id=m.creator_id WHERE ${scope}
          AND m.status IN ('REJECTED','CANCELLED') ORDER BY m.ends_at DESC,m.id LIMIT $4`,
              [user.id, user.email, date, 5],
            )
          ).rows;
      const past = currentOnly
        ? []
        : (
            await client.query(
              `${this.projection}, json_build_object('id',u.id,'displayName',u.display_name) AS organizer
          FROM meetings m JOIN users u ON u.id=m.creator_id WHERE ${scope}
          AND m.status NOT IN ('REJECTED','CANCELLED') AND m.ends_at <= $4::timestamptz
          ORDER BY m.ends_at DESC,m.id LIMIT $5`,
              [user.id, user.email, date, referenceTime, 5],
            )
          ).rows;
      await client.query('COMMIT');
      return {
        referenceTime,
        fingerprint: evidence.fingerprint as string,
        groups: {
          upcomingCurrent: {
            total: Number(evidence.current_total),
            items: upcoming.map((row) => this.coreView(row)),
          },
          rejectedCancelled: {
            total: Number(evidence.rejected_total),
            items: rejected.map((row) => this.coreView(row)),
          },
          past: {
            total: Number(evidence.past_total),
            items: past.map((row) => this.coreView(row)),
          },
        },
      };
    } catch {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  private readPredicate() {
    return `(m.creator_id=$1 OR EXISTS(SELECT 1 FROM meeting_attendees a WHERE a.meeting_id=m.id AND
       (a.member_id=$1 OR (a.member_id IS NULL AND a.email=$2))))`;
  }
  private coreView(row: MeetingView & { organizer: { id: string; displayName: string } }) {
    return {
      id: row.id,
      title: row.title,
      candidate: { name: row.candidate.name },
      position: row.position,
      description: row.description,
      preparationNotes: row.preparationNotes,
      startsAt: row.startsAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
      endsAt: row.endsAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
      status: row.status,
      format: row.format,
      location: row.location,
      joinUrl: row.joinUrl ?? null,
      organizer: row.organizer,
      attendees: row.attendees,
      attendeeCount: row.attendees.length,
    };
  }
  async mutate(creatorId: string, meetingId: string, input: MeetingMutation): Promise<MeetingView> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw unavailable();
    }
    let commitStarted = false;
    let discard = false;
    try {
      await client.query('BEGIN');
      const identity = (
        await client.query<{ create_request_id: string }>(
          'SELECT create_request_id FROM meetings WHERE creator_id=$1 AND id=$2',
          [creatorId, meetingId],
        )
      ).rows[0];
      if (!identity) {
        throw new ApiError(404, 'MEETING_NOT_FOUND');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        creatorId + ':' + identity.create_request_id,
      ]);
      const locked = await client.query(
        `SELECT id, updated_at=$3::timestamptz AS matches,
         (SELECT email FROM users WHERE id=creator_id) AS creator_email
         FROM meetings WHERE creator_id=$1 AND id=$2 FOR UPDATE`,
        [creatorId, meetingId, input.expectedUpdatedAt],
      );
      if (!locked.rows.length) throw new ApiError(404, 'MEETING_NOT_FOUND');
      if (!locked.rows[0].matches) throw new ApiError(409, 'STALE_MEETING');
      let changed = false;
      if (input.attendeeChanges) {
        const changes = input.attendeeChanges;
        const current = (
          await client.query<{ email: string; member_id: string | null }>(
            'SELECT email,member_id FROM meeting_attendees WHERE meeting_id=$1 ORDER BY email',
            [meetingId],
          )
        ).rows;
        const members = (
          await client.query<{ id: string; email: string; display_name: string }>(
            'SELECT id,email,display_name FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
            [changes.addMemberIds],
          )
        ).rows;
        if (members.length !== changes.addMemberIds.length)
          throw new ApiError(400, 'VALIDATION_ERROR', { addMemberIds: 'ไม่พบสมาชิกที่เลือก' });
        if (changes.removeEmails.some((email) => !current.some((a) => a.email === email)))
          throw new ApiError(400, 'VALIDATION_ERROR', {
            removeEmails: 'ไม่พบผู้ร่วมที่เลือกเอาออก',
          });
        if (
          members.some(
            (m) =>
              changes.removeEmails.includes(m.email) ||
              current.some((a) => a.member_id === m.id && changes.removeEmails.includes(a.email)),
          )
        )
          throw new ApiError(400, 'VALIDATION_ERROR', {
            attendeeChanges: 'ไม่สามารถเพิ่มและนำสมาชิกเดียวกันออกพร้อมกัน',
          });
        const retained = current.filter((a) => !changes.removeEmails.includes(a.email));
        const additions = members.filter((m) => !retained.some((a) => a.member_id === m.id));
        if (additions.some((m) => retained.some((a) => a.email === m.email)))
          throw new ApiError(400, 'VALIDATION_ERROR', { addMemberIds: 'มีอีเมลนี้ในทีมแล้ว' });
        if (
          !retained.some((a) =>
            a.member_id !== null
              ? a.member_id !== creatorId
              : a.email !== locked.rows[0].creator_email,
          ) &&
          !additions.some((m) => m.id !== creatorId)
        )
          throw new ApiError(400, 'VALIDATION_ERROR', {
            attendeeChanges: 'เลือกสมาชิกอื่นอย่างน้อยหนึ่งคน',
          });
        if (changes.removeEmails.length) {
          await client.query(
            'DELETE FROM meeting_attendees WHERE meeting_id=$1 AND email=ANY($2::text[])',
            [meetingId, changes.removeEmails],
          );
          changed = true;
        }
        for (const m of additions) {
          await client.query(
            'INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,$2,$3,$4)',
            [meetingId, m.email, m.display_name, m.id],
          );
          changed = true;
        }
      }
      const columns = {
        title: 'title',
        description: 'description',
        preparationNotes: 'preparation_notes',
        candidateName: 'candidate_name',
        candidateEmail: 'candidate_email',
        position: 'position',
        location: 'location',
        joinUrl: 'manual_join_url',
        status: 'status',
      } as const;
      const values: unknown[] = [meetingId];
      const sets: string[] = [],
        differences: string[] = [];
      for (const [key, column] of Object.entries(columns)) {
        const value = input[key as keyof typeof columns];
        if (value === undefined) continue;
        values.push(value);
        sets.push(`${column}=$${values.length}`);
        differences.push(`${column} IS DISTINCT FROM $${values.length}`);
      }
      if (sets.length || changed) {
        await client.query(
          `UPDATE meetings SET ${sets.length ? sets.join(',') + ',' : ''}
          updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 microsecond')
          WHERE id=$1 AND (${changed ? 'true' : differences.join(' OR ')})`,
          values,
        );
      }
      const meeting = await this.find('id', creatorId, meetingId, client);
      if (!meeting) throw unavailable();
      commitStarted = true;
      await client.query('COMMIT');
      return meeting;
    } catch (error) {
      if (commitStarted) discard = true;
      else
        try {
          await client.query('ROLLBACK');
        } catch {
          discard = true;
        }
      if (error instanceof ApiError) throw error;
      throw unavailable();
    } finally {
      client.release(discard);
    }
  }
  private async find(
    column: 'id' | 'create_request_id',
    creatorId: string,
    value: string,
    database: Pool | PoolClient = this.pool,
  ): Promise<MeetingView | null> {
    try {
      // One statement/snapshot must distinguish active, deleted and unused keys.
      const receipt =
        'EXISTS(SELECT 1 FROM deleted_meeting_requests d WHERE d.creator_id=$1 AND d.create_request_id=$2)';
      const query =
        column === 'create_request_id'
          ? `${this.projection}, ${receipt} AS deleted FROM (SELECT 1) anchor
           LEFT JOIN meetings m ON m.creator_id=$1 AND m.create_request_id=$2
           WHERE m.id IS NOT NULL OR ${receipt}`
          : `${this.projection} FROM meetings m WHERE m.creator_id=$1 AND m.id=$2`;
      const result = await database.query(query, [creatorId, value]);
      const row = result.rows[0];
      if (!row) return null;
      if (row.deleted) throw new ApiError(410, 'MEETING_DELETED');
      const { deleted: _deleted, ...view } = row;
      return {
        ...view,
        startsAt: row.startsAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
        endsAt: row.endsAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
        createdAt: row.createdAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
        updatedAt: row.updatedAt.replace(/(\.\d{3}\d*?)0+Z$/, '$1Z'),
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
}
