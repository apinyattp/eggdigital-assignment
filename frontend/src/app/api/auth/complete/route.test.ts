// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { attempts } from "../[...nextauth]/attempts";
import { POST as complete } from "./route";
import { POST as attempt } from "../attempt/route";

const secret = "synthetic-nextauth-secret-for-unit-tests-only";
beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  vi.stubEnv("AUTH_SERVICE_KEY", "synthetic-service-key-for-tests-only");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  vi.stubEnv("COOKIE_SECURE", "false");
  vi.stubEnv("JWT_ACCESS_TTL_SECONDS", "900");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ user: { id: "member", membership: "member" } }),
          ),
      ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function request(
  cookie: string,
  body = "{}",
  headers: Record<string, string> = {},
) {
  return new NextRequest("http://localhost:3000/api/auth/complete", {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-requested-with": "MeetingManager",
      ...headers,
    },
    body,
  });
}
async function evidence(extra: Record<string, unknown> = {}) {
  const started = attempts.start(undefined);
  started.entry.status = "verified";
  const claims = {
    backendAccessToken: "synthetic.exactBackendJwt.signature",
    backendExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    attemptId: started.entry.id,
    authMethod: "password",
    ...extra,
  };
  const wrapper = await encode({ secret, token: claims, maxAge: 60 });
  return {
    ...started,
    claims,
    wrapper,
    cookie: `mm_auth_attempt=${started.binding}; next-auth.session-token=${wrapper}`,
  };
}

describe("N1/N3 HTTP boundary with real official wrapper encryption (TEST-MM-011/023/026/053/055)", () => {
  it("delivers exact backend token once, no token JSON, replay never clears successful cookies", async () => {
    const e = await evidence();
    const response = await complete(request(e.cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      expiresAt: e.claims.backendExpiresAt,
    });
    expect(response.headers.get("set-cookie")).toContain(
      `mm_access=${e.claims.backendAccessToken}`,
    );
    expect(response.headers.get("set-cookie")).toMatch(
      /Path=\/api;.*HttpOnly;.*SameSite=lax/i,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const replay = await complete(request(e.cookie));
    expect(replay.status).toBe(409);
    expect(replay.headers.has("set-cookie")).toBe(false);
  });
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "CANDIDATE_DENIED"],
    [503, "DEPENDENCY_UNAVAILABLE"],
  ] as const)(
    "does not issue access cookie after membership recheck HTTP %s",
    async (status, code) => {
      const e = await evidence();
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { code } }), { status }),
        );
      vi.stubGlobal("fetch", fetch);
      const response = await complete(request(e.cookie));
      expect(response.status).toBe(status);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(fetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/v1/auth/session",
        expect.objectContaining({
          headers: {
            Accept: "application/json",
            Cookie: `mm_access=${e.claims.backendAccessToken}`,
          },
        }),
      );
    },
  );
  it("rejects a stale Guest success and cancellation during membership read", async () => {
    const e = await evidence();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ user: { id: null, membership: "guest" } }),
          ),
        ),
    );
    expect((await complete(request(e.cookie))).status).toBe(401);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        attempts.cancel(e.binding);
        return new Response(
          JSON.stringify({ user: { id: "member", membership: "member" } }),
        );
      }),
    );
    const response = await complete(request(e.cookie));
    expect(response.status).toBe(409);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("supports official session-cookie chunk assembly", async () => {
    const e = await evidence();
    const midpoint = Math.floor(e.wrapper.length / 2);
    const response = await complete(
      request(
        `mm_auth_attempt=${e.binding}; next-auth.session-token.0=${e.wrapper.slice(0, midpoint)}; next-auth.session-token.1=${e.wrapper.slice(midpoint)}`,
      ),
    );
    expect(response.status).toBe(200);
  });
  it("rejects valid Bearer wrapper without a cookie and rejects forged wrapper", async () => {
    const e = await evidence();
    for (const r of [
      request(`mm_auth_attempt=${e.binding}`, "{}", {
        authorization: `Bearer ${e.wrapper}`,
      }),
      request(`mm_auth_attempt=${e.binding}; next-auth.session-token=forged`),
    ]) {
      const response = await complete(r);
      expect(response.status).toBe(401);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
  });
  it.each([0, -1, 500])(
    "rejects expired/subsecond remaining backend expiry (%s ms) without a cookie",
    async (offset) => {
      const e = await evidence({
        backendExpiresAt: new Date(Date.now() + offset).toISOString(),
      });
      const response = await complete(request(e.cookie));
      expect(response.status).toBe(401);
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it("rejects cancellation and mismatched attempt id", async () => {
    const a = await evidence();
    attempts.cancel(a.binding);
    expect((await complete(request(a.cookie))).status).toBe(409);
    const b = await evidence({ attemptId: "different-attempt" });
    expect((await complete(request(b.cookie))).status).toBe(403);
  });
  it("rechecks cancellation occurring while official decode awaits", async () => {
    const e = await evidence();
    const pending = complete(request(e.cookie));
    attempts.cancel(e.binding);
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it.each([
    [{ origin: "https://other.test" }, "{}", 403],
    [{ "x-requested-with": "" }, "{}", 403],
    [{ "content-type": "text/plain" }, "{}", 415],
    [{}, "{", 400],
    [{}, "[]", 400],
    [{}, '{"token":"forged"}', 400],
    [{}, " ".repeat(16_385), 400],
  ] as const)(
    "rejects invalid custom bridge request",
    async (headers, body, status) => {
      const response = await complete(request("", body, headers));
      expect(response.status).toBe(status);
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it("cancel clears access and binding at original paths without requiring key/JWT/DB", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SERVICE_KEY", "");
    const response = await attempt(request("", '{"action":"cancel"}'));
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/mm_access=; Path=\/api; Max-Age=0/),
        expect.stringMatching(/mm_auth_attempt=; Path=\/api\/auth; Max-Age=0/),
      ]),
    );
  });
  it("allows repeated starts beyond former quota with no Retry-After", async () => {
    for (let n = 0; n < 12; n++) {
      const response = await attempt(request("", '{"action":"start"}'));
      expect(response.status).toBe(200);
      expect(response.headers.has("retry-after")).toBe(false);
      expect(await response.json()).toEqual({ ok: true });
    }
  });
  it("rejects array/object coercion of the N1 action", async () => {
    for (const action of [["start"], ["cancel"], {}, true])
      expect(
        (await attempt(request("", JSON.stringify({ action })))).status,
      ).toBe(400);
  });
});
