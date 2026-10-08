// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialsConfig } from "next-auth/providers/credentials";
vi.mock("server-only", () => ({}));
const issuer = vi.hoisted(() => ({ issueIdentity: vi.fn() }));
vi.mock("@/api/serverAuth", () => issuer);
import { createAuthOptions, type RequestAuthContext } from "./authOptions";
import { attempts, BridgeError } from "./attempts";
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-next-secret-for-options-tests");
  vi.stubEnv("AUTH_SERVICE_KEY", "synthetic-caller-key-for-options-tests");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("COOKIE_SECURE", "false");
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const started = attempts.start(undefined);
  const context: RequestAuthContext = {};
  const options = createAuthOptions(started.binding, context);
  const provider = options.providers[0] as CredentialsConfig;
  const authorize = provider.options!.authorize!;
  return { ...started, options, authorize, context };
}
const result = () => ({
  accessToken: "synthetic.exact.signature",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: "synthetic",
    displayName: "Member",
    email: "member@example.test",
    membership: "member",
  },
});
describe("request-local NextAuth options with mocked B1 (TEST-MM-010/027/050/053/055)", () => {
  it.each([
    ["MEMBER_NOT_FOUND", 404],
    ["CANDIDATE_DENIED", 403],
  ] as const)(
    "returns Google %s to login without verified token claims",
    async (code, status) => {
      const x = setup();
      x.entry.status = "exchanging";
      x.context.attempt = x.entry;
      x.context.method = "google";
      issuer.issueIdentity.mockRejectedValue(new BridgeError(code, status));
      expect(
        await x.options.callbacks!.signIn!({
          user: { id: "synthetic" },
          account: {
            provider: "google",
            type: "oauth",
            providerAccountId: "synthetic",
            id_token: "synthetic",
          },
        }),
      ).toBe(`http://localhost:3000/login?authError=${code}`);
      expect(x.entry.status).not.toBe("verified");
      await expect(
        x.options.callbacks!.jwt!({
          token: {},
          user: { id: "synthetic" },
          account: null,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );
  it("accepts registered Google Member through the same wrapper", async () => {
    const x = setup();
    x.entry.status = "exchanging";
    x.context.attempt = x.entry;
    x.context.method = "google";
    issuer.issueIdentity.mockResolvedValue(result());
    expect(
      await x.options.callbacks!.signIn!({
        user: { id: "synthetic" },
        account: {
          provider: "google",
          type: "oauth",
          providerAccountId: "synthetic",
          id_token: "synthetic",
        },
      }),
    ).toBe(true);
    const token = await x.options.callbacks!.jwt!({
      token: {},
      user: { id: "synthetic" },
      account: null,
    });
    expect(token.authMethod).toBe("google");
    expect(x.entry.status).toBe("verified");
  });
  it("rechecks cancellation after issuer await and never initializes token claims", async () => {
    const x = setup();
    issuer.issueIdentity.mockImplementation(async () => {
      attempts.cancel(x.binding);
      return result();
    });
    await expect(
      x.authorize({ email: "test", password: "test" }, {}),
    ).rejects.toThrow("AUTH_ATTEMPT_CANCELLED");
    expect(x.entry.status).toBe("cancelled");
  });
  it("duplicate authorize cannot fail another operation's already verified entry", async () => {
    const x = setup();
    x.entry.status = "verified";
    await expect(
      x.authorize({ email: "test", password: "test" }, {}),
    ).rejects.toThrow();
    expect(x.entry.status).toBe("verified");
  });
  it("wraps only server result, session exposes expiry only, client updates do not replace claims", async () => {
    const x = setup();
    const data = result();
    issuer.issueIdentity.mockResolvedValue(data);
    await x.authorize({ email: "test", password: "test" }, {});
    // Callback invocation is controlled unit evidence; actual library route is tested separately.
    const token = await x.options.callbacks!.jwt!({
      token: {},
      user: { id: "synthetic" },
      account: null,
    });
    expect(token).toEqual({
      backendAccessToken: data.accessToken,
      backendExpiresAt: data.expiresAt,
      attemptId: x.entry.id,
      authMethod: "password",
    });
    const session = await x.options.callbacks!.session!({
      session: { expires: "wrong" },
      token,
      user: { id: "synthetic", email: "test", emailVerified: null },
      newSession: {},
      trigger: "update",
    });
    expect(session).toEqual({ expires: data.expiresAt });
    const updated = await x.options.callbacks!.jwt!({
      token,
      trigger: "update",
      session: { backendAccessToken: "forged", backendExpiresAt: "2099-01-01" },
      user: { id: "synthetic" },
      account: null,
    });
    expect(updated).toBe(token);
    expect(issuer.issueIdentity).toHaveBeenCalledTimes(1);
  });
});
