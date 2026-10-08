import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { OAuth2Client } from 'google-auth-library';
import { createApp } from '../src/app.js';
import { GoogleIdentityService } from '../src/integrations/google/google-identity.js';
import { loadConfig } from '../src/config/env.js';
import { ApiError } from '../src/utils/api-error.js';
import { config, harness, password } from './support.js';

let h: Awaited<ReturnType<typeof harness>>;
const body = { method: 'password', email: 'sample01@example.test', password };
const issue = () =>
  request(h.app).post('/internal/auth/issue').set('X-Auth-Service-Key', config.authServiceKey!);
beforeEach(async () => {
  h = await harness();
});
afterEach(() => vi.restoreAllMocks());

describe('TEST-MM-027 B1 authenticated internal caller', () => {
  it('rejects missing/wrong keys before parsing or accessing identity dependencies', async () => {
    for (const key of [undefined, 'wrong', 'x'.repeat(1025)]) {
      let r = request(h.app).post('/internal/auth/issue').set('Origin', config.allowedOrigin);
      if (key) r = r.set('X-Auth-Service-Key', key);
      const result = await r.set('Content-Type', 'application/json').send('{invalid');
      expect(result.status).toBe(401);
      expect(result.body.error.code).toBe('INTERNAL_CALLER_UNAUTHORIZED');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(h.model.findByEmail).not.toHaveBeenCalled();
    expect(h.google.verifyIdToken).not.toHaveBeenCalled();
  });
  it('fails closed without configured caller key and rejects duplicate key headers', async () => {
    const app = createApp(
      { ...config, authServiceKey: undefined },
      h.auth,
      h.google,
      h.model,
      h.memberService,
      h.meetingService,
    );
    expect(
      (
        await request(app)
          .post('/internal/auth/issue')
          .set('X-Auth-Service-Key', config.authServiceKey!)
          .send(body)
      ).status,
    ).toBe(401);
    const duplicate = await request(h.app)
      .post('/internal/auth/issue')
      .set('X-Auth-Service-Key', [config.authServiceKey!, config.authServiceKey!])
      .send(body);
    expect(duplicate.status).toBe(401);
    expect(h.model.findByEmail).not.toHaveBeenCalled();
  });
  it('accepts UUID correlation only after caller auth and otherwise keeps a generated ID', async () => {
    const id = '40000000-0000-4000-8000-000000000001';
    const valid = await issue()
      .set('X-Request-ID', id)
      .send({ ...body, password: 'wrong' });
    expect(valid.body.requestId).toBe(id);
    const invalid = await issue()
      .set('X-Request-ID', 'untrusted text')
      .send({ ...body, password: 'wrong' });
    expect(invalid.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(invalid.body.requestId).not.toBe('untrusted text');
    const unauthorized = await request(h.app)
      .post('/internal/auth/issue')
      .set('X-Request-ID', id)
      .send(body);
    expect(unauthorized.body.requestId).not.toBe(id);
  });
});

describe('TEST-MM-011/012/023/024 B1 transport and common issuer', () => {
  it('returns the Express password token to the authenticated server without Set-Cookie', async () => {
    const r = await issue().send({ ...body, email: ' SAMPLE01@EXAMPLE.TEST ' });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['accessToken', 'expiresAt', 'user']);
    expect(r.headers['set-cookie']).toBeUndefined();
    const verified = await h.tokens.verify(r.body.accessToken);
    expect(verified.identity.authMethod).toBe('password');
    expect(verified.expiresAt).toBe(r.body.expiresAt);
    const session = await request(h.app)
      .get('/api/v1/auth/session')
      .set('Cookie', 'mm_access=' + r.body.accessToken);
    expect(session.status).toBe(200);
    expect(session.body.user).toEqual(r.body.user);
    expect(session.body).not.toHaveProperty('accessToken');
  });
  it('rejects client identity overrides and incompatible discriminated bodies', async () => {
    for (const input of [
      { ...body, role: 'member' },
      { ...body, verifiedEmail: 'other@gmail.com' },
      { ...body, method: 'unknown' },
      { method: 'google', idToken: 'controlled', email: 'other@gmail.com' },
      { method: 'google', idToken: '' },
      { method: 'google', idToken: 'x'.repeat(8193) },
    ])
      expect((await issue().send(input)).status).toBe(400);
    expect(h.model.findByEmail).not.toHaveBeenCalled();
    expect(h.google.verifyIdToken).not.toHaveBeenCalled();
  });
  it('handles wrong media, malformed and oversized JSON with safe errors', async () => {
    expect((await issue().type('text').send('credentials')).status).toBe(415);
    expect((await issue().set('Content-Type', 'application/json').send('{')).status).toBe(400);
    expect((await issue().send({ ...body, password: 'x'.repeat(18000) })).status).toBe(400);
    expect(h.model.findByEmail).not.toHaveBeenCalled();
  });
  it('does not impose password or Google login-count limits', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await issue()
        .set('X-Auth-Client-IP', '192.0.2.' + i)
        .set('X-Forwarded-For', '198.51.100.' + i)
        .send({
          ...body,
          email: i % 2 ? ' SAMPLE01@EXAMPLE.TEST ' : body.email,
          password: 'wrong',
        });
      expect(r.status).toBe(401);
      expect(r.headers['retry-after']).toBeUndefined();
    }
    expect((await issue().send(body)).status).toBe(200);
    for (let i = 0; i < 15; i++)
      expect((await issue().send({ method: 'google', idToken: 'controlled-token' })).status).toBe(
        200,
      );
  });
  it('admits Google Members and returns404 for missing membership while retaining Candidate denial', async () => {
    const r = await issue().send({ method: 'google', idToken: 'controlled-token' });
    expect(r.status).toBe(200);
    expect(r.body.user.membership).toBe('member');
    expect((await h.tokens.verify(r.body.accessToken)).identity.authMethod).toBe('google');
    expect(h.google.verifyIdToken).toHaveBeenCalledWith('controlled-token');
    expect(h.google.exchange).not.toHaveBeenCalled();
    h.members.clear();
    const issueToken = vi.spyOn(h.tokens, 'issue');
    const missing = await issue().send({ method: 'google', idToken: 'controlled-token' });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({
      code: 'MEMBER_NOT_FOUND',
      message: 'ไม่พบบัญชีสมาชิกสำหรับอีเมล Google นี้',
    });
    expect(missing.body).not.toHaveProperty('accessToken');
    expect(missing.body).not.toHaveProperty('user');
    expect(missing.headers['set-cookie']).toBeUndefined();
    expect(issueToken).not.toHaveBeenCalled();
    h.candidates.add(body.email);
    const denied = await issue().send({ method: 'google', idToken: 'controlled-token' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('CANDIDATE_DENIED');
    expect(denied.body).not.toHaveProperty('accessToken');
    expect(denied.headers['set-cookie']).toBeUndefined();
    expect(issueToken).not.toHaveBeenCalled();
  });
  it('preserves exact password and denies Candidate/DB/provider errors without tokens', async () => {
    expect((await issue().send({ ...body, password: password.trim() })).status).toBe(401);
    h.candidates.add(body.email);
    expect((await issue().send(body)).body.error.code).toBe('CANDIDATE_DENIED');
    h.model.findByEmail.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE'));
    const failed = await issue().send(body);
    expect(failed.status).toBe(503);
    expect(failed.body).not.toHaveProperty('accessToken');
    h.google.verifyIdToken.mockRejectedValue(new ApiError(401, 'GOOGLE_IDENTITY_INVALID'));
    expect((await issue().send({ method: 'google', idToken: 'controlled-token' })).status).toBe(
      401,
    );
  });
});

describe('TEST-MM-024/054 extracted Google verifier (controlled library outcome)', () => {
  const audience = 'synthetic.apps.googleusercontent.com';
  function verified(change: Record<string, unknown> = {}) {
    return vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        sub: '1234',
        email: 'Member@gmail.com',
        email_verified: true,
        ...change,
      }),
    } as never);
  }
  it('verifies with audience alone and never performs another authorization-code exchange', async () => {
    const verify = verified();
    const exchange = vi.spyOn(OAuth2Client.prototype, 'getToken');
    const service = new GoogleIdentityService(undefined, audience);
    expect((await service.verifyIdToken('controlled-id-token')).email).toBe('member@gmail.com');
    expect(verify).toHaveBeenCalledWith({ idToken: 'controlled-id-token', audience });
    expect(exchange).not.toHaveBeenCalled();
    expect(() => service.checkAvailable()).toThrow(); // Legacy code exchange is still unavailable.
  });
  it.each([
    { aud: 'wrong' },
    { iss: 'wrong' },
    { exp: 0 },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { sub: 123 },
    { sub: '' },
    { email_verified: false },
    { email: undefined },
  ])('rejects invalid provider claims %#', async (change) => {
    verified(change);
    await expect(
      new GoogleIdentityService(undefined, audience).verifyIdToken('controlled'),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_INVALID' });
  });
  it('preserves Workspace acceptance and nonauthoritative third-party denial', async () => {
    const verify = verified({ email: 'member@example.test', hd: 'example.test' });
    const service = new GoogleIdentityService(undefined, audience);
    expect((await service.verifyIdToken('controlled')).email).toBe('member@example.test');
    verify.mockRestore();
    verified({ email: 'member@example.test' });
    await expect(service.verifyIdToken('controlled')).rejects.toMatchObject({
      code: 'EMAIL_OWNERSHIP_UNVERIFIED',
    });
  });
  it('requires audience while preserving legacy nonce checking', async () => {
    await expect(
      new GoogleIdentityService(undefined).verifyIdToken('controlled'),
    ).rejects.toMatchObject({ code: 'GOOGLE_AUTH_UNAVAILABLE' });
    verified({ nonce: 'original' });
    await expect(
      new GoogleIdentityService(undefined, audience).verifyIdToken('controlled', 'different'),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_INVALID' });
  });
  it('loads independent audience without Google secret/legacy redirect and validates caller config safely', () => {
    const env = {
      DATABASE_URL: config.databaseUrl,
      JWT_SIGNING_KEY_BASE64: Buffer.from(config.signingKey).toString('base64'),
      GOOGLE_CLIENT_ID: audience,
    };
    const loaded = loadConfig(env);
    expect(loaded.googleClientId).toBe(audience);
    expect(loaded.google).toBeUndefined();
    expect(loaded.authServiceKey).toBeUndefined();
    expect(() => loadConfig({ ...env, AUTH_SERVICE_KEY: 'short-private-test' })).toThrow(
      'Invalid configuration keys: AUTH_SERVICE_KEY',
    );
  });
});
