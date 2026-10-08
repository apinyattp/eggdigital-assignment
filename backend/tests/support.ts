import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { Config } from '../src/config/env.js';
import type { Member } from '../src/models/auth.model.js';
import { AuthService } from '../src/services/auth.service.js';
import { TokenService } from '../src/services/token.service.js';
import { OAuthTransactions } from '../src/services/oauth-transaction.service.js';
import { createApp } from '../src/app.js';
import { MemberService } from '../src/services/member.service.js';
import { MeetingService } from '../src/services/meeting.service.js';
import { vi } from 'vitest';
export const config: Config = {
  port: 3001,
  databaseUrl: 'postgresql://test:test@127.0.0.1/meeting_manager_test',
  allowedOrigin: 'http://localhost:3000',
  signingKey: randomBytes(32),
  issuer: 'urn:meeting-manager:local',
  audience: 'urn:meeting-manager:api',
  ttlSeconds: 900,
  secureCookies: false,
  authServiceKey: randomBytes(32).toString('base64url'),
};
export const password = 'Synthetic test password with spaces ';
export const memberId = '10000000-0000-4000-8000-000000000001';
export async function harness(now: () => number = Date.now) {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const members = new Map<string, Member>([
    [
      'sample01@example.test',
      {
        id: memberId,
        email: 'sample01@example.test',
        display_name: 'Sample 01',
        password_hash: hash,
      },
    ],
  ]);
  const candidates = new Set<string>();
  const model = {
    findByEmail: vi.fn(async (email: string) => members.get(email) ?? null),
    findById: vi.fn(async (id: string) => [...members.values()].find((m) => m.id === id) ?? null),
    checkCandidate: vi.fn(async (email: string) => candidates.has(email)),
    checkReady: vi.fn(async () => {}),
  };
  const google = {
    checkAvailable: vi.fn(() => {}),
    authorizationUrl: vi.fn(
      (state: string, nonce: string) =>
        `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`,
    ),
    exchange: vi.fn(async (_code: string, _nonce: string) => ({
      sub: '1234567890',
      email: 'sample01@example.test',
      displayName: 'Provider name',
    })),
    verifyIdToken: vi.fn(async (_idToken: string) => ({
      sub: '1234567890',
      email: 'sample01@example.test',
      displayName: 'Provider name',
    })),
  };
  const tokens = new TokenService(config, now);
  const transactions = new OAuthTransactions(now);
  const auth = new AuthService(model, tokens, google, hash);
  const memberModel = { readPage: vi.fn(async () => ({ items: [], total: 0 })) };
  const meetingModel = {
    findById: vi.fn(async () => null),
    findByRequestId: vi.fn(async () => null),
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
  const memberService = new MemberService(memberModel);
  const meetingService = new MeetingService(meetingModel, () => new Date('2026-10-08T03:00:00Z'));
  const app = createApp(config, auth, google, model, memberService, meetingService, transactions);
  return {
    app,
    auth,
    tokens,
    transactions,
    model,
    google,
    members,
    candidates,
    memberService,
    meetingService,
    memberModel,
    meetingModel,
  };
}
export function cookie(response: { headers: Record<string, unknown> }, name: string): string {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  return cookies?.find((c) => c.startsWith(name + '='))?.split(';')[0] ?? '';
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
