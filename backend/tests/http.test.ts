import { beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { harness, config, password, cookie, memberId } from './support.js';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/utils/api-error.js';
let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});
const post = (path: string) =>
  request(h.app)
    .post('/api/v1/auth' + path)
    .set('Origin', config.allowedOrigin)
    .set('X-Requested-With', 'MeetingManager');
const issue = (body: unknown) =>
  request(h.app)
    .post('/internal/auth/issue')
    .set('X-Auth-Service-Key', config.authServiceKey!)
    .send(body);
const access = (r: { body: { accessToken: string } }) => 'mm_access=' + r.body.accessToken;

describe('LOGIN r3 legacy retirement and retained L4/L5', () => {
  it('returns404 for retired Calendar/Zoom connection and cleanup routes while Member auth works', async () => {
    const login = await issue({ method: 'password', email: 'sample01@example.test', password });
    expect(login.status).toBe(200);
    for (const path of [
      '/api/v1/provider-connections',
      '/api/v1/meetings/30000000-0000-4000-8000-000000000002/provider-cleanup',
    ]) {
      const result = await request(h.app).get(path).set('Cookie', access(login));
      expect(result.status).toBe(404);
      expect(result.body.error.code).toBe('NOT_FOUND');
    }
    for (const provider of ['google-calendar', 'zoom']) {
      for (const action of ['authorize', 'callback']) {
        const result = await request(h.app)
          .post('/api/v1/provider-connections/' + provider + '/' + action)
          .set('Cookie', access(login))
          .set('Origin', config.allowedOrigin)
          .set('X-Requested-With', 'MeetingManager')
          .send({});
        expect(result.status).toBe(404);
        expect(result.body.error.code).toBe('NOT_FOUND');
      }
    }
  });

  it.each(['/login', '/google/start', '/google/exchange'])(
    'retired %s returns 404 without issuing, querying or calling provider',
    async (path) => {
      const r = await post(path).send({
        email: 'sample01@example.test',
        password,
        code: 'unused',
        state: 'unused',
      });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(h.model.findByEmail).not.toHaveBeenCalled();
      expect(h.model.findPrincipal).not.toHaveBeenCalled();
      expect(h.google.verifyIdToken).not.toHaveBeenCalled();
    },
  );
  it('TEST-MM-008/010/011 issuer token works at unchanged L4; L5 clears both cookie paths', async () => {
    const login = await issue({ method: 'password', email: ' SAMPLE01@EXAMPLE.TEST ', password });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    const session = await request(h.app).get('/api/v1/auth/session').set('Cookie', access(login));
    expect(session.status).toBe(200);
    expect(session.body).toEqual({ user: login.body.user, expiresAt: login.body.expiresAt });
    expect(session.body.user.id).toBe(memberId);
    expect(session.body.user.password_hash).toBeUndefined();
    expect(session.body.accessToken).toBeUndefined();
    expect(session.headers['cache-control']).toBe('no-store');
    expect(session.headers['set-cookie']).toBeUndefined();
    const logout = await post('/logout').set('Cookie', access(login)).send({});
    expect(logout.status).toBe(204);
    const headers = logout.headers['set-cookie'] as unknown as string[];
    expect(headers).toHaveLength(2);
    expect(headers.find((s) => s.startsWith('mm_access='))).toContain('Path=/api;');
    expect(headers.find((s) => s.startsWith('mm_google_tx='))).toContain('Path=/api/v1/auth;');
    for (const header of headers) {
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).not.toContain('Domain=');
    }
    expect((await request(h.app).get('/api/v1/auth/session')).status).toBe(401);
  });
  it('TEST-MM-012 retains unlimited password/Google issuer attempts and generic failures', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await issue({
        method: 'password',
        email: 'sample01@example.test',
        password: 'invalid',
      });
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(r.headers['retry-after']).toBeUndefined();
    }
    expect(
      (await issue({ method: 'password', email: 'sample01@example.test', password })).status,
    ).toBe(200);
    for (let i = 0; i < 15; i++)
      expect((await issue({ method: 'google', idToken: 'controlled' })).status).toBe(200);
  });
  it('TEST-MM-011 preserves logout Origin/custom-header/media/JSON/body validation', async () => {
    expect((await request(h.app).post('/api/v1/auth/logout').send({})).status).toBe(403);
    expect(
      (
        await request(h.app)
          .post('/api/v1/auth/logout')
          .set('Origin', 'http://evil.test')
          .set('X-Requested-With', 'MeetingManager')
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(h.app)
          .post('/api/v1/auth/logout')
          .set('Origin', config.allowedOrigin)
          .send({})
      ).status,
    ).toBe(403);
    expect((await post('/logout').type('text').send('{}')).status).toBe(415);
    expect(
      (await post('/logout').set('Content-Type', 'application/json; charset=iso-8859-1').send('{}'))
        .status,
    ).toBe(415);
    expect((await post('/logout').type('json').send('{')).status).toBe(400);
    expect((await post('/logout').send({ unexpected: true })).status).toBe(400);
    expect((await post('/logout').send({ payload: 'x'.repeat(17000) })).status).toBe(400);
  });
  it('TEST-MM-011 preserves exact-origin preflight and does not reflect foreign origin', async () => {
    const yes = await request(h.app)
      .options('/api/v1/auth/logout')
      .set('Origin', config.allowedOrigin);
    expect(yes.status).toBe(204);
    expect(yes.headers['access-control-allow-origin']).toBe(config.allowedOrigin);
    const no = await request(h.app)
      .options('/api/v1/auth/logout')
      .set('Origin', 'http://evil.test');
    expect(no.status).toBe(403);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('TEST-MM-025 rejects bearer-only credentials and maps current DB failure safely', async () => {
    expect(
      (await request(h.app).get('/api/v1/auth/session').set('Authorization', 'Bearer synthetic'))
        .status,
    ).toBe(401);
    const login = await issue({ method: 'password', email: 'sample01@example.test', password });
    h.model.findPrincipal.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE'));
    const r = await request(h.app).get('/api/v1/auth/session').set('Cookie', access(login));
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it.each(['password', 'google'] as const)(
    'TEST-MM-025 current Candidate denies %s before issuance and existing-token use',
    async (method) => {
      const body =
        method === 'password'
          ? { method, email: 'sample01@example.test', password }
          : { method, idToken: 'controlled' };
      const login = await issue(body);
      expect(login.status).toBe(200);
      h.candidates.add('sample01@example.test');
      expect(
        (await request(h.app).get('/api/v1/auth/session').set('Cookie', access(login))).status,
      ).toBe(403);
      const denied = await issue(body);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('CANDIDATE_DENIED');
      expect(denied.body.accessToken).toBeUndefined();
    },
  );
  it('TEST-MM-025 Google session is rejected after Member removal without creating accounts', async () => {
    const login = await issue({ method: 'google', idToken: 'controlled' });
    expect(login.body.user.membership).toBe('member');
    h.members.clear();
    const s = await request(h.app).get('/api/v1/auth/session').set('Cookie', access(login));
    expect(s.status).toBe(401);
    expect(s.body.error.code).toBe('UNAUTHENTICATED');
    expect(s.body).not.toHaveProperty('user');
    expect(s.headers['set-cookie']).toBeUndefined();
    expect(h.members.size).toBe(0);
  });
  it('rejects a previously issued Google Guest token before session, meeting and member access', async () => {
    const old = await h.tokens.issue({
      authMethod: 'google',
      subject: 'google:former-guest',
      verifiedEmail: 'former-guest@example.test',
    });
    for (const path of [
      '/api/v1/auth/session',
      '/api/v1/meetings?date=2026-10-08',
      '/api/v1/members?query=sample',
    ]) {
      const response = await request(h.app)
        .get(path)
        .set('Cookie', 'mm_access=' + old.token);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    expect(h.memberModel.readPage).not.toHaveBeenCalled();
    expect(h.meetingModel.readSnapshot).not.toHaveBeenCalled();
  });
  it('TEST-MM-025 password account removal rejects existing token', async () => {
    const login = await issue({ method: 'password', email: 'sample01@example.test', password });
    h.members.clear();
    expect(
      (await request(h.app).get('/api/v1/auth/session').set('Cookie', access(login))).status,
    ).toBe(401);
  });
  it('TEST-MM-026/055 logout needs no DB/token and does not revoke other or copied JWTs', async () => {
    const a = await issue({ method: 'password', email: 'sample01@example.test', password });
    const b = await issue({ method: 'password', email: 'sample01@example.test', password });
    const calls = h.model.findPrincipal.mock.calls.length;
    h.model.findPrincipal.mockRejectedValueOnce(new ApiError(503, 'DEPENDENCY_UNAVAILABLE'));
    const r = await post('/logout').set('Cookie', 'mm_access=invalid').send({});
    expect(r.status).toBe(204);
    expect(h.model.findPrincipal.mock.calls.length).toBe(calls);
    expect(cookie(r, 'mm_access')).toBe('mm_access=');
    h.model.findPrincipal.mockReset().mockImplementation(async () => ({
      member: h.members.get('sample01@example.test')!,
      candidateDenied: false,
    }));
    for (const x of [a, b])
      expect(
        (await request(h.app).get('/api/v1/auth/session').set('Cookie', access(x))).status,
      ).toBe(200);
  });
  it('clears legacy and access cookies with secure attributes without auth dependencies', async () => {
    const secureConfig = {
      ...config,
      allowedOrigin: 'https://app.example.test',
      secureCookies: true,
    };
    const app = createApp(secureConfig, h.auth, h.model, h.memberService, h.meetingService);
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', secureConfig.allowedOrigin)
      .set('X-Requested-With', 'MeetingManager')
      .set('Cookie', 'mm_google_tx=legacy-binding; mm_access=invalid')
      .send({});
    expect(response.status).toBe(204);
    const headers = response.headers['set-cookie'] as unknown as string[];
    expect(headers).toHaveLength(2);
    expect(headers.find((s) => s.startsWith('mm_access='))).toContain('Path=/api;');
    expect(headers.find((s) => s.startsWith('mm_google_tx='))).toContain('Path=/api/v1/auth;');
    for (const header of headers) {
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Secure');
      expect(header).not.toContain('Domain=');
    }
    expect(h.model.findPrincipal).not.toHaveBeenCalled();
    expect(h.model.findByEmail).not.toHaveBeenCalled();
    expect(h.google.verifyIdToken).not.toHaveBeenCalled();
  });
});
