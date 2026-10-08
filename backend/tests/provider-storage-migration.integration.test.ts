import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { requireLocalDatabase } from '../scripts/local-database.js';
import { MeetingModel } from '../src/models/meeting.model.js';

const databaseUrl = requireLocalDatabase(process.env.TEST_DATABASE_URL, true);
const admin = new Pool({ connectionString: databaseUrl });
const retired = [
  'provider_connections',
  'meeting_calendar_links',
  'meeting_provider_operations',
  'meeting_provider_cleanup',
];
const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
afterAll(async () => admin.end());

async function isolatedSchema(
  run: (
    pool: Pool,
    migrate: (count?: number, dryRun?: boolean) => Promise<unknown>,
  ) => Promise<void>,
) {
  const schema = 'retirement_' + randomUUID().replaceAll('-', '');
  const pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const migrate = (count?: number, dryRun = false) =>
    runner({
      databaseUrl,
      dir,
      schema,
      createSchema: true,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      singleTransaction: true,
      count,
      dryRun,
      logger: quiet,
    });
  try {
    await run(pool, migrate);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}
async function tables(pool: Pool) {
  return (
    await pool.query('SELECT tablename FROM pg_tables WHERE schemaname=current_schema()')
  ).rows.map((r) => r.tablename);
}

describe('Forward provider-storage retirement migration', () => {
  it('installs the complete migration chain on an empty schema and reruns without changes', async () => {
    await isolatedSchema(async (pool, migrate) => {
      await migrate();
      for (const name of retired) expect(await tables(pool)).not.toContain(name);
      expect((await pool.query('SELECT count(*)::int n FROM pgmigrations')).rows[0].n).toBe(12);
      expect(await migrate()).toEqual([]);
      expect((await pool.query('SELECT count(*)::int n FROM meetings')).rows[0].n).toBe(0);
      expect(await tables(pool)).toContain('deleted_meeting_requests');
    });
  });

  it('preserves eligible legacy links and unrelated rows; dry-run and failed DROP do not change data', async () => {
    await isolatedSchema(async (pool, migrate) => {
      await migrate(11);
      const owner = randomUUID(),
        connection = randomUUID();
      await pool.query(
        "INSERT INTO users(id,email,display_name) VALUES($1,'legacy@example.test','Legacy')",
        [owner],
      );
      await pool.query(
        `INSERT INTO provider_connections(id,creator_id,provider,provider_subject,granted_scopes,credentials_ciphertext,nonce,authentication_tag,key_version,access_expires_at,status)
        VALUES($1,$2,'GOOGLE_CALENDAR','fixture','{}',decode('00','hex'),decode(repeat('00',12),'hex'),decode(repeat('00',16),'hex'),'fixture','2026-01-01','reconnect_required')`,
        [connection, owner],
      );
      const scenarios = [
        {
          name: 'normal',
          link: 'https://meet.google.com/old-room',
          expected: 'https://meet.google.com/old-room',
        },
        {
          name: 'manual',
          link: 'https://zoom.us/old',
          manual: 'https://example.test/manual',
          expected: 'https://example.test/manual',
        },
        {
          name: 'suppressed',
          link: 'https://example.test/suppressed',
          cleanup: true,
          expected: null,
        },
        {
          name: 'cancelled',
          link: 'https://example.test/cancelled',
          cancelled: true,
          expected: null,
        },
        {
          name: 'failed',
          link: 'https://example.test/failed',
          phase: 'FAILED_MANUAL',
          expected: null,
        },
        { name: 'missing', link: null, missing: true, expected: null },
        { name: 'http', link: 'http://example.test/unsafe', expected: null },
        { name: 'credentials', link: 'https://user:password@example.test/unsafe', expected: null },
        { name: 'malformed', link: 'https://', expected: null },
        {
          name: 'normalized',
          link: ' HTTPS://EXAMPLE.TEST/legacy ',
          expected: 'https://example.test/legacy',
        },
        {
          name: 'quote',
          link: "https://example.test/path?q='quoted'",
          expected: "https://example.test/path?q='quoted'",
        },
        {
          name: 'wrong-request',
          link: 'https://example.test/wrong',
          wrongRequest: true,
          expected: null,
        },
        { name: 'onsite', link: 'https://example.test/onsite', onsite: true, expected: null },
        {
          name: 'cancelled-manual',
          link: 'https://example.test/old',
          manual: 'https://example.test/manual',
          cancelled: true,
          expected: 'https://example.test/manual',
        },
        {
          name: 'suppressed-manual',
          link: 'https://example.test/old',
          manual: 'https://example.test/manual',
          cleanup: true,
          expected: 'https://example.test/manual',
        },
      ];
      const ids = new Map<string, string>();
      for (const scenario of scenarios) {
        const id = randomUUID(),
          requestId = randomUUID();
        ids.set(scenario.name, id);
        await pool.query(
          `INSERT INTO meetings(id,creator_id,create_request_id,title,candidate_name,candidate_email,position,starts_at,ends_at,format,status,meeting_provider,external_meeting_id,manual_join_url)
          VALUES($1,$2,$3,$4,'Candidate','candidate@example.test','Engineer','2026-10-09T02:00Z','2026-10-09T03:00Z',$5,$6,$7,$8,$9)`,
          [
            id,
            owner,
            requestId,
            scenario.name,
            scenario.onsite ? 'ONSITE' : 'ONLINE',
            scenario.cancelled ? 'CANCELLED' : 'CONFIRMED',
            scenario.onsite ? null : 'GOOGLE_MEET',
            scenario.onsite ? null : 'external-fixture',
            scenario.manual ?? null,
          ],
        );
        if (!scenario.missing)
          await pool.query(
            `INSERT INTO meeting_provider_operations(creator_id,request_id,operation_id,provider,google_connection_id,phase,external_meeting_id,join_url,calendar_id,calendar_event_id,meeting_id)
          VALUES($1,$2,$3,'GOOGLE_MEET',$4,$5,'external-fixture',$6,'primary',$7,$8)`,
            [
              owner,
              scenario.wrongRequest ? randomUUID() : requestId,
              randomUUID(),
              connection,
              scenario.phase ?? 'COMPLETED',
              scenario.link,
              randomUUID(),
              id,
            ],
          );
        if (scenario.cleanup)
          await pool.query(
            `INSERT INTO meeting_provider_cleanup(meeting_id,operation_id,creator_id,create_request_id,provider,google_connection_id,local_action,calendar_state,room_state,calendar_notification)
          VALUES($1,$2,$3,$4,'GOOGLE_MEET',$5,'CANCEL','PENDING','PENDING','NOT_REQUESTED')`,
            [id, randomUUID(), owner, requestId, connection],
          );
        await pool.query(
          "INSERT INTO meeting_calendar_links(meeting_id,connection_id,calendar_id,event_id) VALUES($1,$2,'primary',$3)",
          [id, connection, randomUUID()],
        );
      }
      const meetingId = ids.get('normal')!;
      await pool.query(
        "INSERT INTO interview_notes(meeting_id,author_key,content) VALUES($1,'member:fixture','Keep note')",
        [meetingId],
      );
      await pool.query(
        "INSERT INTO meeting_feedback(id,meeting_id,author_key,author_name,create_request_id,content) VALUES($1,$2,'member:fixture','Legacy',$3,'Keep feedback')",
        [randomUUID(), meetingId, randomUUID()],
      );
      await pool.query(
        "INSERT INTO meeting_attendees(meeting_id,email,display_name,member_id) VALUES($1,'legacy@example.test','Legacy',$2)",
        [meetingId, owner],
      );
      await pool.query(
        'INSERT INTO deleted_meeting_requests(creator_id,create_request_id,meeting_id) VALUES($1,$2,$3)',
        [owner, randomUUID(), randomUUID()],
      );
      const before = (await pool.query('SELECT to_jsonb(m) AS row FROM meetings m ORDER BY id'))
        .rows;
      const otherTables = [
        'users',
        'meeting_attendees',
        'interview_notes',
        'meeting_feedback',
        'deleted_meeting_requests',
      ];
      const beforeOther = await Promise.all(
        otherTables.map(
          async (name) =>
            (
              await pool.query(
                `SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
        ),
      );
      await migrate(undefined, true);
      expect(
        (await pool.query('SELECT to_jsonb(m) AS row FROM meetings m ORDER BY id')).rows,
      ).toEqual(before);
      expect((await pool.query('SELECT count(*)::int n FROM pgmigrations')).rows[0].n).toBe(11);
      // Prove transactional rollback instead of silently cascading an unknown dependency.
      await pool.query(
        'CREATE TABLE unexpected_dependency(connection_id uuid REFERENCES provider_connections(id))',
      );
      await expect(migrate()).rejects.toHaveProperty('code', '2BP01');
      expect(
        (await pool.query('SELECT to_jsonb(m) AS row FROM meetings m ORDER BY id')).rows,
      ).toEqual(before);
      for (const name of retired) expect(await tables(pool)).toContain(name);
      await pool.query('DROP TABLE unexpected_dependency');
      await migrate();
      const after = (await pool.query('SELECT to_jsonb(m) AS row FROM meetings m ORDER BY id'))
        .rows;
      const expected = before.map(({ row }) => {
        const { meeting_provider, external_meeting_id, ...rest } = row;
        return {
          row: { ...rest, manual_join_url: scenarios.find((s) => s.name === row.title)!.expected },
        };
      });
      expect(after).toEqual(expected);
      for (const name of retired) expect(await tables(pool)).not.toContain(name);
      expect(
        await Promise.all(
          otherTables.map(
            async (name) =>
              (
                await pool.query(
                  `SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`,
                )
              ).rows,
          ),
        ),
      ).toEqual(beforeOther);
      const model = new MeetingModel(pool);
      for (const scenario of scenarios) {
        const meeting = await model.findById(owner, ids.get(scenario.name)!);
        expect(meeting?.joinUrl).toBe(
          scenario.cancelled || scenario.onsite ? null : scenario.expected,
        );
        expect(meeting).not.toHaveProperty('meetingProvider');
        expect(meeting).not.toHaveProperty('externalMeetingId');
      }
      await expect(
        pool.query("UPDATE meetings SET manual_join_url='http://unsafe.test' WHERE id=$1", [
          meetingId,
        ]),
      ).rejects.toHaveProperty('code', '23514');
      expect(await migrate()).toEqual([]);
      expect(
        (await pool.query('SELECT to_jsonb(m) AS row FROM meetings m ORDER BY id')).rows,
      ).toEqual(after);
    });
  });

  it('does not pretend a down migration can reconstruct removed provider history', () => {
    const migration = createRequire(import.meta.url)(
      '../migrations/1791421000000_retire-provider-storage.cjs',
    );
    expect(() => migration.down()).toThrow('irreversible');
  });
});
