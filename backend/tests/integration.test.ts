import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import request from 'supertest';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { jwtVerify } from 'jose';
import { requireLocalDatabase } from '../scripts/local-database.js';
import { migrate } from '../scripts/migrate.js';
import { seedLoginFixtures, fixtureIds } from '../scripts/fixtures.js';
import { config, cookie, password } from './support.js';
import { AuthModel } from '../src/models/auth.model.js';
import { AuthService } from '../src/services/auth.service.js';
import { TokenService } from '../src/services/token.service.js';
import { createApp } from '../src/app.js';
import { MemberService } from '../src/services/member.service.js';
import { MeetingService } from '../src/services/meeting.service.js';
import { MemberModel } from '../src/models/member.model.js';
import { MeetingModel } from '../src/models/meeting.model.js';
import { GoogleIdentityService } from '../src/integrations/google/google-identity.js';
const databaseUrl = requireLocalDatabase(process.env.TEST_DATABASE_URL, true);
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
const model = new AuthModel(pool);
const tokens = new TokenService(config);
const provider = {
  checkAvailable() {},
  authorizationUrl(state: string, nonce: string) {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`;
  },
  async exchange() {
    return {
      sub: 'fixture-google-sub',
      email: 'sample01@example.test',
      displayName: 'Controlled provider',
    };
  },
  async verifyIdToken() {
    return this.exchange();
  },
};
let auth: AuthService;
let app: ReturnType<typeof createApp>;
const issue = (body: unknown) =>
  request(app)
    .post('/internal/auth/issue')
    .set('X-Auth-Service-Key', config.authServiceKey!)
    .send(body);
describe('TEST-MM-008/023/025/053 Express JWT issuance with real PostgreSQL', () => {
  it.each(['password', 'google'] as const)(
    '%s Login issues the API JWT and rechecks current Candidate data',
    async (method) => {
      // Real B1 issuer/SQL; controlled provider identity only. Browser bridge owns cookie installation.
      const response = await issue(
        method === 'password'
          ? { method, email: 'sample01@example.test', password }
          : { method, idToken: 'controlled-provider-id-token' },
      );
      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe(fixtureIds.member);
      expect(response.body).not.toHaveProperty('token');
      const access = 'mm_access=' + response.body.accessToken;
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(access).not.toBe('');
      const { payload, protectedHeader } = await jwtVerify(
        access.slice('mm_access='.length),
        config.signingKey,
        { algorithms: ['HS256'], issuer: config.issuer, audience: config.audience },
      );
      expect(protectedHeader.typ).toBe('JWT');
      expect(payload.token_use).toBe('access');
      expect(payload.auth_method).toBe(method);
      expect(payload.sub).toBe(
        method === 'password' ? fixtureIds.member : 'google:fixture-google-sub',
      );
      expect(payload.exp! - payload.iat!).toBe(config.ttlSeconds);
      expect(response.body.expiresAt).toBe(new Date(payload.exp! * 1000).toISOString());
      const current = await request(app).get('/api/v1/auth/session').set('Cookie', access);
      expect(current.status).toBe(200);
      expect(current.body.user.membership).toBe('member');
      await pool.query("UPDATE meetings SET candidate_email='sample01@example.test'");
      const denied = await request(app).get('/api/v1/auth/session').set('Cookie', access);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('CANDIDATE_DENIED');
    },
  );
});
beforeAll(async () => {
  await migrate(databaseUrl);
  await migrate(databaseUrl);
  auth = new AuthService(model, tokens, provider, await argon2.hash(randomBytes(32)));
  app = createApp(
    config,
    auth,
    provider,
    model,
    new MemberService(new MemberModel(pool)),
    new MeetingService(new MeetingModel(pool)),
  );
});
describe('TEST-MM-023/025/027 B1 common issuer with real PostgreSQL', () => {
  it.each(['password', 'google'] as const)(
    '%s issues through the private server boundary',
    async (method) => {
      const r = await request(app)
        .post('/internal/auth/issue')
        .set('X-Auth-Service-Key', config.authServiceKey!)
        .send(
          method === 'password'
            ? { method, email: 'sample01@example.test', password }
            : { method, idToken: 'controlled-provider-id-token' },
        );
      expect(r.status).toBe(200);
      expect(r.headers['set-cookie']).toBeUndefined();
      const { payload } = await jwtVerify(r.body.accessToken, config.signingKey, {
        algorithms: ['HS256'],
        issuer: config.issuer,
        audience: config.audience,
      });
      expect(payload.auth_method).toBe(method);
      expect(r.body.user.id).toBe(fixtureIds.member);
      expect(r.body.expiresAt).toBe(new Date(payload.exp! * 1000).toISOString());
      const access = 'mm_access=' + r.body.accessToken;
      expect((await request(app).get('/api/v1/auth/session').set('Cookie', access)).status).toBe(
        200,
      );
      await pool.query("UPDATE meetings SET candidate_email='sample01@example.test'");
      expect((await request(app).get('/api/v1/auth/session').set('Cookie', access)).status).toBe(
        403,
      );
    },
  );
});
beforeEach(async () => {
  await pool.query(
    'TRUNCATE meeting_provider_cleanup,meeting_calendar_links,meeting_provider_operations,provider_connections,interview_notes,meeting_feedback,deleted_meeting_requests,meeting_attendees,meetings,users',
  );
  await seedLoginFixtures(pool, password);
});
afterAll(async () => {
  await pool.end();
});
describe('TEST-MM-054 pinned real PostgreSQL schema/fixtures', () => {
  it('has exact 5/19/4 field counts and no login session/revocation schema', async () => {
    const rows = (
      await pool.query(
        "SELECT table_name,count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name",
      )
    ).rows;
    for (const [name, count] of [
      ['users', 5],
      ['meetings', 19],
      ['meeting_attendees', 4],
      ['provider_connections', 15],
      ['meeting_provider_operations', 16],
      ['meeting_calendar_links', 7],
      ['meeting_provider_cleanup', 21],
    ])
      expect(rows.find((r) => r.table_name === name)?.count).toBe(count);
    expect(
      rows.some((r) =>
        ['sessions', 'auth_version', 'refresh_tokens', 'revocations'].includes(r.table_name),
      ),
    ).toBe(false);
    const columns = (
      await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public'",
      )
    ).rows.map((r) => r.column_name);
    for (const forbidden of [
      'auth_version',
      'email_key',
      'candidate_email_key',
      'create_payload_hash',
      'google_id',
    ])
      expect(columns.includes(forbidden)).toBe(false);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM pgmigrations')).rows[0].count,
    ).toBe(11);
  });
  it('enforces canonical/unique email and data constraints in real SQL', async () => {
    await expect(
      pool.query(
        "INSERT INTO users(id,email,display_name) VALUES($1,' SAMPLE01@EXAMPLE.TEST ','invalid')",
        ['10000000-0000-4000-8000-000000000099'],
      ),
    ).rejects.toHaveProperty('code', '23514');
    await expect(
      pool.query(
        "INSERT INTO users(id,email,display_name) VALUES($1,'sample01@example.test','duplicate')",
        ['10000000-0000-4000-8000-000000000099'],
      ),
    ).rejects.toHaveProperty('code', '23505');
    await expect(pool.query('UPDATE meetings SET ends_at=starts_at')).rejects.toHaveProperty(
      'code',
      '23514',
    );
    await expect(
      pool.query("UPDATE meetings SET meeting_provider='ZOOM',external_meeting_id='123'"),
    ).rejects.toHaveProperty('code', '23514');
    const meeting = (
      await pool.query('SELECT format,location,meeting_provider,external_meeting_id FROM meetings')
    ).rows[0];
    expect(meeting).toEqual({
      format: 'ONSITE',
      location: null,
      meeting_provider: null,
      external_meeting_id: null,
    });
  });
  it('preserves FK and fixture transaction atomicity', async () => {
    await expect(
      pool.query('DELETE FROM users WHERE id=$1', [fixtureIds.member]),
    ).rejects.toHaveProperty('code', '23001');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM meeting_attendees');
      await c.query('DELETE FROM meetings');
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect((await pool.query('SELECT count(*)::int AS count FROM meetings')).rows[0].count).toBe(1);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM meeting_attendees')).rows[0].count,
    ).toBe(1);
  });
  it('rejects mutation of unknown remote or non-test databases', () => {
    expect(() =>
      requireLocalDatabase('postgresql://a:b@remote.invalid/meeting_manager_test', true),
    ).toThrow();
    expect(() => requireLocalDatabase('postgresql://a:b@localhost/production', true)).toThrow();
  });
});
describe('TEST-MM-008/009/025 real SQL password and current-principal checks', () => {
  it('logs in, returns identity, and preserves expiry without leaking credentials', async () => {
    const r = await issue({ method: 'password', email: ' SAMPLE01@EXAMPLE.TEST ', password });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(fixtureIds.member);
    const s = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', 'mm_access=' + r.body.accessToken);
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ user: r.body.user, expiresAt: r.body.expiresAt });
    expect(Object.keys(r.body.user).sort()).toEqual(['displayName', 'email', 'id', 'membership']);
  });
  it.each(['password', 'google'] as const)(
    'reads a %s session in one SQL statement without selecting password hashes',
    async (authMethod) => {
      const identity =
        authMethod === 'password'
          ? { authMethod, subject: fixtureIds.member }
          : { authMethod, subject: 'google:controlled', verifiedEmail: 'sample01@example.test' };
      const { token } = await tokens.issue(identity);
      const query = vi.spyOn(pool, 'query');
      try {
        const session = await auth.findSession(token);
        expect(session.user.id).toBe(fixtureIds.member);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0]![0]).not.toMatch(/password_hash|SELECT\s+\*/i);
        expect(query.mock.results[0]!.type).toBe('return');
        const result = await query.mock.results[0]!.value;
        expect(Object.keys(result.rows[0]).sort()).toEqual([
          'denied',
          'display_name',
          'email',
          'id',
        ]);
      } finally {
        query.mockRestore();
      }
    },
  );
  it('checks the current password member email after an email change, then rejects deletion', async () => {
    const id = fixtureIds.googleOnly;
    const { token } = await tokens.issue({ authMethod: 'password', subject: id });
    expect((await auth.findSession(token)).user.email).toBe('google-only@example.test');
    await pool.query("UPDATE users SET email='changed@example.test' WHERE id=$1", [id]);
    expect((await auth.findSession(token)).user.email).toBe('changed@example.test');
    await pool.query("UPDATE meetings SET candidate_email='changed@example.test'");
    await expect(auth.findSession(token)).rejects.toMatchObject({
      status: 403,
      code: 'CANDIDATE_DENIED',
    });
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    await expect(auth.findSession(token)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });
  it('denies Candidate even if member and attendee, independent of dates/status', async () => {
    await pool.query(
      "INSERT INTO meeting_attendees VALUES($1,'candidate01@example.test','Candidate',$2)",
      [fixtureIds.meeting, fixtureIds.candidate],
    );
    await pool.query(
      "UPDATE meetings SET status='REJECTED',starts_at='2000-01-01T00:00Z',ends_at='2000-01-01T01:00Z'",
    );
    const r = await issue({ method: 'password', email: 'candidate01@example.test', password });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CANDIDATE_DENIED');
    expect(cookie(r, 'mm_access')).toBe('');
  });
  it('denies nonmember Candidate through controlled verified Google identity', async () => {
    await pool.query("UPDATE meetings SET candidate_email='candidate02@example.test'");
    const identity = {
      authMethod: 'google' as const,
      subject: 'google:controlled',
      verifiedEmail: 'candidate02@example.test',
    };
    await expect(auth.findPrincipal(identity)).rejects.toMatchObject({ code: 'CANDIDATE_DENIED' });
  });
  it('current Google principal rejects missing/deleted Member without auto-creation', async () => {
    const guest = {
      authMethod: 'google' as const,
      subject: 'google:controlled',
      verifiedEmail: 'new@gmail.com',
    };
    await expect(auth.findPrincipal(guest)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    const id = '10000000-0000-4000-8000-000000000098';
    await pool.query(
      "INSERT INTO users(id,email,display_name) VALUES($1,'new@gmail.com','New member')",
      [id],
    );
    expect((await auth.findPrincipal(guest)).membership).toBe('member');
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    await expect(auth.findPrincipal(guest)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM users WHERE email='new@gmail.com'"))
        .rows[0].count,
    ).toBe(0);
  });
  it('NULL password hash cannot log in, and current password user removal rejects old identity', async () => {
    expect(
      (await issue({ method: 'password', email: 'google-only@example.test', password })).status,
    ).toBe(401);
    const issued = await tokens.issue({ authMethod: 'password', subject: fixtureIds.googleOnly });
    await pool.query('DELETE FROM users WHERE id=$1', [fixtureIds.googleOnly]);
    await expect(auth.findSession(issued.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('database reconnect preserves rows and same-key JWT, while new key rejects it', async () => {
    const issued = await tokens.issue({ authMethod: 'password', subject: fixtureIds.member });
    const freshPool = new Pool({ connectionString: databaseUrl });
    try {
      const freshModel = new AuthModel(freshPool);
      const freshTokens = new TokenService(config);
      const freshAuth = new AuthService(freshModel, freshTokens, provider, 'unused');
      expect((await freshAuth.findSession(issued.token)).user.id).toBe(fixtureIds.member);
      await expect(
        new TokenService({ ...config, signingKey: randomBytes(32) }).verify(issued.token),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    } finally {
      await freshPool.end();
    }
  });
  it('maps actual closed database pool to 503, while logout does not need DB', async () => {
    const deadPool = new Pool({ connectionString: databaseUrl });
    await deadPool.end();
    const deadModel = new AuthModel(deadPool);
    const deadAuth = new AuthService(deadModel, tokens, provider, 'unused');
    for (const identity of [
      { authMethod: 'password' as const, subject: fixtureIds.member },
      {
        authMethod: 'google' as const,
        subject: 'google:controlled',
        verifiedEmail: 'sample01@example.test',
      },
    ]) {
      await expect(deadAuth.findPrincipal(identity)).rejects.toMatchObject({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
      });
    }
    const deadApp = createApp(
      config,
      deadAuth,
      provider,
      deadModel,
      new MemberService(new MemberModel(pool)),
      new MeetingService(new MeetingModel(pool)),
    );
    const r = await request(deadApp)
      .post('/internal/auth/issue')
      .set('X-Auth-Service-Key', config.authServiceKey!)
      .send({ method: 'password', email: 'sample01@example.test', password });
    expect(r.status).toBe(503);
    expect(
      (
        await request(deadApp)
          .post('/api/v1/auth/logout')
          .set('Origin', config.allowedOrigin)
          .set('X-Requested-With', 'MeetingManager')
          .send({})
      ).status,
    ).toBe(204);
  });
});
