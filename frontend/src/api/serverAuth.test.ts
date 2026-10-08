// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issueIdentity } from "./serverAuth";
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "synthetic-next-secret-for-server-tests");
  vi.stubEnv("AUTH_SERVICE_KEY", "synthetic-caller-key-for-server-tests");
  vi.stubEnv("AUTH_BACKEND_INTERNAL_URL", "http://localhost:3001");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("COOKIE_SECURE", "false");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const issued = () => ({
  accessToken: "synthetic.exact.signature",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: "synthetic",
    displayName: "Member",
    email: "member@example.test",
    membership: "member",
  },
});
describe("B1 server adapter (mocked issuer, TEST-MM-023/024/027)", () => {
  it("sends exact password, canonical email and authenticated UUID correlation, no browser IP", async () => {
    const data = issued();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetch);
    expect(
      await issueIdentity({
        method: "password",
        email: " Member@Example.Test ",
        password: " exact password ",
      }),
    ).toEqual(data);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://localhost:3001/internal/auth/issue");
    expect(JSON.parse(init.body)).toEqual({
      method: "password",
      email: "member@example.test",
      password: " exact password ",
    });
    expect(init.headers["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.headers["X-Auth-Service-Key"]).toBe(
      "synthetic-caller-key-for-server-tests",
    );
    expect(Object.keys(init.headers)).not.toContain("X-Forwarded-For");
  });
  it("sends only Google ID token to B1 and accepts its verified Member response", async () => {
    const data = issued();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await issueIdentity({
          method: "google",
          idToken: "synthetic-provider-token",
        })
      ).user.membership,
    ).toBe("member");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      method: "google",
      idToken: "synthetic-provider-token",
    });
  });
  it.each(["password", "google"] as const)(
    "rejects a stale Guest success for %s",
    async (method) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              ...issued(),
              user: {
                id: null,
                displayName: "Unregistered",
                email: "unregistered@example.test",
                membership: "guest",
              },
            }),
          ),
        ),
      );
      await expect(
        issueIdentity(
          method === "google"
            ? { method, idToken: "synthetic" }
            : { method, email: "synthetic", password: "synthetic" },
        ),
      ).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
    },
  );
  it.each([
    ["MEMBER_NOT_FOUND", 404],
    ["CANDIDATE_DENIED", 403],
    ["INVALID_CREDENTIALS", 401],
  ] as const)("preserves %s and HTTP %s", async (code, status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code, message: "raw-secret" } }),
            { status },
          ),
        ),
    );
    await expect(
      issueIdentity({ method: "google", idToken: "synthetic" }),
    ).rejects.toMatchObject({ code, status });
  });
  it.each([
    "CANDIDATE_DENIED",
    "EMAIL_OWNERSHIP_UNVERIFIED",
    "DEPENDENCY_UNAVAILABLE",
  ])("preserves safe %s without raw errors", async (code) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code, message: "raw-secret" } }),
            { status: 403 },
          ),
        ),
    );
    await expect(
      issueIdentity({ method: "google", idToken: "synthetic" }),
    ).rejects.toMatchObject({ message: code });
  });
  it("rejects invalid backend expiry and never exposes unknown error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...issued(),
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }),
        ),
      ),
    );
    await expect(
      issueIdentity({ method: "password", email: "test", password: "test" }),
    ).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
});
