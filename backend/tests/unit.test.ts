import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import { config, memberId, harness, password } from './support.js';
import { loadConfig } from '../src/config/env.js';
import { TokenService, canonicalEmail } from '../src/services/token.service.js';
import { GoogleIdentityService } from '../src/integrations/google/google-identity.js';
import { passwordBody } from '../src/middlewares/validate.middleware.js';
import { AuthModel } from '../src/models/auth.model.js';

describe('principal database lookup boundary', () => {
  it.each(['id', 'email'] as const)(
    'reads the %s principal and candidate flag in one parameterized query without password data',
    async (column) => {
      const row = {
        id: memberId,
        email: 'sample01@example.test',
        display_name: 'Sample 01',
        denied: true,
      };
      const query = vi.fn().mockResolvedValue({ rows: [row] });
      const value = column === 'id' ? memberId : row.email;
      const result = await new AuthModel({ query } as never).findPrincipal(column, value);
      expect(result).toEqual({
        member: { id: row.id, email: row.email, display_name: row.display_name },
        candidateDenied: true,
      });
      expect(query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [value]);
      const sql = query.mock.calls[0]![0] as string;
      expect(sql).toContain(`LEFT JOIN users AS member ON member.${column} = $1`);
      expect(sql).toContain(`candidate_email = ${column === 'id' ? 'member.email' : '$1'}`);
      expect(sql).not.toContain('password_hash');
    },
  );
  it.each([true, false])(
    'preserves candidateDenied=%s when the member is missing',
    async (denied) => {
      const query = vi.fn().mockResolvedValue({
        rows: [{ id: null, email: null, display_name: null, denied }],
      });
      await expect(
        new AuthModel({ query } as never).findPrincipal('email', 'candidate@example.test'),
      ).resolves.toEqual({ member: null, candidateDenied: denied });
      expect(query).toHaveBeenCalledTimes(1);
    },
  );
  it('maps a principal query failure to dependency unavailable without retrying', async () => {
    const query = vi.fn().mockRejectedValue(new Error('database failed'));
    await expect(
      new AuthModel({ query } as never).findPrincipal('id', memberId),
    ).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('keeps password-hash retrieval confined to the separate email lookup', async () => {
    const member = {
      id: memberId,
      email: 'sample01@example.test',
      display_name: 'Sample 01',
      password_hash: 'controlled-hash',
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [member] })
      .mockResolvedValueOnce({ rows: [] });
    const model = new AuthModel({ query } as never);
    await expect(model.findByEmail(member.email)).resolves.toEqual(member);
    await expect(model.findByEmail('missing@example.test')).resolves.toBeNull();
    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT id,email,display_name,password_hash FROM users WHERE email = $1',
      [member.email],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SELECT id,email,display_name,password_hash FROM users WHERE email = $1',
      ['missing@example.test'],
    );
  });
});

describe('TEST-MM-007/008 normalization and password', () => {
  it('normalizes case/edges without collapsing dots or plus aliases', () => {
    expect(canonicalEmail('  A.B+Tag@Example.Test ')).toBe('a.b+tag@example.test');
  });
  it('preserves password bytes and rejects empty values', () => {
    expect(passwordBody.parse({ email: ' A@Example.Test ', password: '  x ' })).toEqual({
      email: 'a@example.test',
      password: '  x ',
    });
    expect(passwordBody.safeParse({ email: 'a@example.test', password: '' }).success).toBe(false);
  });
  it('uses exact password; unknown, wrong, and NULL hash remain generic', async () => {
    const h = await harness();
    await expect(
      h.auth.savePasswordLogin(' SAMPLE01@EXAMPLE.TEST ', password),
    ).resolves.toHaveProperty('user.membership', 'member');
    for (const [email, pw] of [
      ['sample01@example.test', password.trim()],
      ['unknown@example.test', password],
    ])
      await expect(h.auth.savePasswordLogin(email!, pw!)).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    h.members.get('sample01@example.test')!.password_hash = null;
    await expect(h.auth.savePasswordLogin('sample01@example.test', password)).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
  });
});
describe('Google login requires an existing Member before JWT issuance', () => {
  it('rejects a verified non-Member without issuing a token', async () => {
    const h = await harness();
    h.members.clear();
    const issue = vi.spyOn(h.tokens, 'issue');
    const login = h.auth.saveGoogleIdTokenLogin('controlled-id-token');
    await expect(login).rejects.toMatchObject({ status: 404, code: 'MEMBER_NOT_FOUND' });
    expect(issue).not.toHaveBeenCalled();
    expect(h.members.size).toBe(0);
  });
  it('preserves Candidate denial before missing membership', async () => {
    const h = await harness();
    h.members.clear();
    h.candidates.add('sample01@example.test');
    const issue = vi.spyOn(h.tokens, 'issue');
    const login = h.auth.saveGoogleIdTokenLogin('controlled-id-token');
    await expect(login).rejects.toMatchObject({ status: 403, code: 'CANDIDATE_DENIED' });
    expect(issue).not.toHaveBeenCalled();
  });
  it('retains the registered Member identity and Google token', async () => {
    const h = await harness();
    const result = await h.auth.saveGoogleIdTokenLogin('controlled-id-token');
    expect(result.user).toMatchObject({
      id: memberId,
      membership: 'member',
      displayName: 'Sample 01',
    });
    expect((await h.tokens.verify(result.token)).identity).toMatchObject({
      authMethod: 'google',
      verifiedEmail: 'sample01@example.test',
    });
  });
});
describe('current-principal lookup', () => {
  it.each(['password', 'google'] as const)(
    'uses one narrow lookup for each %s session read',
    async (authMethod) => {
      const h = await harness();
      const identity =
        authMethod === 'password'
          ? { authMethod, subject: memberId }
          : { authMethod, subject: 'google:controlled', verifiedEmail: 'sample01@example.test' };
      const { token } = await h.tokens.issue(identity);
      for (let read = 1; read <= 2; read++) {
        await expect(h.auth.findSession(token)).resolves.toHaveProperty('user.id', memberId);
        expect(h.model.findPrincipal).toHaveBeenCalledTimes(read);
      }
      expect(h.model.findPrincipal).toHaveBeenLastCalledWith(
        authMethod === 'password' ? 'id' : 'email',
        authMethod === 'password' ? memberId : 'sample01@example.test',
      );
      expect(h.model.findByEmail).not.toHaveBeenCalled();
    },
  );
  it('keeps missing password membership unauthorized even when a candidate flag is returned', async () => {
    const h = await harness();
    h.model.findPrincipal.mockResolvedValue({ member: null, candidateDenied: true });
    await expect(
      h.auth.findPrincipal({ authMethod: 'password', subject: memberId }, 404),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
describe('TEST-MM-053/055 JWT verification', () => {
  const clock = () => 1_791_370_000_000;
  const tokens = new TokenService(config, clock);
  const identity = { authMethod: 'password' as const, subject: memberId };
  it('supports password/Google typed subjects and distinct logins', async () => {
    const a = await tokens.issue(identity);
    const b = await tokens.issue(identity);
    expect(a.token === b.token).toBe(false);
    expect((await tokens.verify(a.token)).identity).toEqual(identity);
    const g = {
      authMethod: 'google' as const,
      subject: 'google:123456',
      verifiedEmail: 'guest@gmail.com',
    };
    expect((await tokens.verify((await tokens.issue(g)).token)).identity).toEqual(g);
  });
  const variants: Record<string, Record<string, unknown>> = {
    wrong_method: { auth_method: 'other' },
    invalid_password_sub: { sub: 'bad' },
    google_email_missing: { auth_method: 'google', sub: 'google:123' },
    google_sub_invalid: { auth_method: 'google', sub: memberId, verified_email: 'guest@gmail.com' },
    noncanonical_email: {
      auth_method: 'google',
      sub: 'google:123',
      verified_email: 'Guest@gmail.com',
    },
    wrong_use: { token_use: 'refresh' },
    wrong_jti: { jti: 'bad' },
    wrong_iat_type: { iat: '123' },
    future_iat: { iat: 1_791_371_000 },
    too_long: { exp: 1_791_380_000 },
    expired: { exp: 1_791_369_999 },
    missing_sub: { sub: undefined },
    wrong_issuer: { iss: 'other' },
    wrong_audience: { aud: 'other' },
    audience_wrong_type: { aud: [config.audience] },
  };
  for (const [name, change] of Object.entries(variants))
    it('rejects ' + name, async () => {
      const p = {
        sub: memberId,
        jti: '10000000-0000-4000-8000-000000000009',
        iat: 1_791_370_000,
        exp: 1_791_370_900,
        iss: config.issuer,
        aud: config.audience,
        auth_method: 'password',
        token_use: 'access',
        ...change,
      };
      const token = await new SignJWT(p)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .sign(config.signingKey);
      await expect(tokens.verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  for (const [name, header, key] of [
    ['wrong_type', { alg: 'HS256', typ: 'other' }, config.signingKey],
    ['key_url', { alg: 'HS256', typ: 'JWT', jku: 'https://invalid.test/key' }, config.signingKey],
    ['wrong_algorithm', { alg: 'HS384', typ: 'JWT' }, randomBytes(48)],
    ['bad_signature', { alg: 'HS256', typ: 'JWT' }, randomBytes(32)],
  ] as const)
    it('rejects ' + name, async () => {
      const token = await new SignJWT({
        sub: memberId,
        jti: '10000000-0000-4000-8000-000000000009',
        iat: 1_791_370_000,
        exp: 1_791_370_900,
        iss: config.issuer,
        aud: config.audience,
        auth_method: 'password',
        token_use: 'access',
      })
        .setProtectedHeader(header)
        .sign(key);
      await expect(tokens.verify(token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  it('expires exactly at exp and survives same-key restart only', async () => {
    const result = await tokens.issue(identity);
    await expect(
      new TokenService(config, () => clock() + 900_000).verify(result.token),
    ).rejects.toMatchObject({ status: 401 });
    await expect(new TokenService(config, clock).verify(result.token)).resolves.toHaveProperty(
      'identity.subject',
      memberId,
    );
    await expect(
      new TokenService({ ...config, signingKey: randomBytes(32) }, clock).verify(result.token),
    ).rejects.toMatchObject({ status: 401 });
  });
});
describe('TEST-MM-054 configuration', () => {
  const env = {
    DATABASE_URL: config.databaseUrl,
    JWT_SIGNING_KEY_BASE64: Buffer.from(config.signingKey).toString('base64'),
  };
  it('rejects missing/short signing keys without exposing supplied values', () => {
    for (const key of [undefined, 'short'])
      expect(() => loadConfig({ ...env, JWT_SIGNING_KEY_BASE64: key })).toThrow(
        'JWT_SIGNING_KEY_BASE64',
      );
  });
  it('password config works without Google; retired settings do not disable ID-token verification', () => {
    expect(loadConfig(env).googleClientId).toBeUndefined();
    expect(
      loadConfig({
        ...env,
        GOOGLE_CLIENT_ID: ' public-id ',
        GOOGLE_CLIENT_SECRET: 'synthetic',
        GOOGLE_REDIRECT_URI: 'http://localhost:3000/wrong',
      }).googleClientId,
    ).toBe('public-id');
  });
});
describe('TEST-MM-024 controlled Google verifier outcomes (not live provider)', () => {
  afterEach(() => vi.restoreAllMocks());
  const audience = 'synthetic.apps.googleusercontent.com';
  function mocks(payload: Record<string, unknown>) {
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        ...payload,
      }),
    } as never);
  }
  it('checks nonce and verified Gmail identity', async () => {
    mocks({
      sub: '1234',
      email: 'Member@gmail.com',
      email_verified: true,
      nonce: 'expected',
      name: 'Member',
    });
    const service = new GoogleIdentityService(audience);
    expect(await service.verifyIdToken('controlled-id-token', 'expected')).toEqual({
      sub: '1234',
      email: 'member@gmail.com',
      displayName: 'Member',
    });
    await expect(service.verifyIdToken('controlled-id-token', 'wrong')).rejects.toMatchObject({
      code: 'GOOGLE_IDENTITY_INVALID',
    });
  });
  for (const [name, change] of Object.entries({
    unverified: { email_verified: false },
    missing_email: { email: undefined },
    empty_sub: { sub: '' },
    nonce: { nonce: 'wrong' },
    wrong_issuer: { iss: 'https://invalid.test' },
    wrong_audience: { aud: 'other' },
    audience_wrong_type: { aud: [config.audience] },
    expired: { exp: 0 },
  }))
    it('rejects ' + name, async () => {
      mocks({
        sub: '123',
        email: 'a@gmail.com',
        email_verified: true,
        nonce: 'expected',
        ...change,
      });
      await expect(
        new GoogleIdentityService(audience).verifyIdToken('controlled-id-token', 'expected'),
      ).rejects.toMatchObject({ status: 401 });
    });
  it('accepts verified Workspace without persistent linking', async () => {
    mocks({
      sub: '123',
      email: 'a@example.test',
      email_verified: true,
      hd: 'example.test',
      nonce: 'expected',
    });
    await expect(
      new GoogleIdentityService(audience).verifyIdToken('controlled-id-token', 'expected'),
    ).resolves.toHaveProperty('email', 'a@example.test');
  });
  it('classifies verification dependency failure without retrying', async () => {
    const verify = vi
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockRejectedValue({ code: 'ETIMEDOUT' });
    await expect(
      new GoogleIdentityService(audience).verifyIdToken('controlled-id-token', 'expected'),
    ).rejects.toMatchObject({ code: 'GOOGLE_AUTH_UNAVAILABLE' });
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('rejects token-verifier signature failure', async () => {
    mocks({});
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockRejectedValue(
      new Error('signature verification failed'),
    );
    await expect(
      new GoogleIdentityService(audience).verifyIdToken('controlled-id-token', 'expected'),
    ).rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_INVALID' });
  });
});
