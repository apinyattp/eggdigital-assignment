import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi, AuthError, googleAuthorizationUrl } from "./authApi";
import { authErrorMessage } from "./authErrorMessages";
const library = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCsrfToken: vi.fn(),
}));
vi.mock("next-auth/react", () => library);

const session = {
  user: {
    id: "synthetic-id",
    displayName: "Test",
    email: "member@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
afterEach(() => vi.unstubAllGlobals());
// TEST-MM-007/027/041/053: transport assertions with mocked fetch only.
describe("auth HTTP adapter (mocked fetch)", () => {
  it("sends exact password, normalized email and required credential/CSRF headers", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, expiresAt: session.expiresAt }),
        ),
      );
    library.signIn.mockResolvedValue({ ok: true, status: 200, error: null });
    vi.stubGlobal("fetch", fetch);
    await authApi.login(" Member@Example.Test ", " pass word ");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/auth/attempt");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "MeetingManager",
      },
    });
    expect(JSON.parse(init.body)).toEqual({ action: "start" });
    expect(library.signIn).toHaveBeenCalledWith("credentials", {
      email: "member@example.test",
      password: " pass word ",
      redirect: false,
      callbackUrl: "/login?complete=1",
    });
    expect(fetch.mock.calls[1][0]).toBe("/api/auth/complete");
    expect(init.headers).not.toHaveProperty("Authorization");
  });
  it("uses current-identity GET and bodyless 204 logout", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    library.signOut.mockResolvedValue({ url: "/login" });
    vi.stubGlobal("fetch", fetch);
    expect(await authApi.session()).toEqual(session);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("body");
    await authApi.logout();
    expect(fetch.mock.calls[1][1].body).toBe('{"action":"cancel"}');
    expect(fetch.mock.calls[2][1].body).toBe("{}");
  });
  it("does not treat a non-204 logout as acknowledged cookie clear", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(authApi.logout()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it.each(["cancel", "signout", "backend"])(
    "attempts every cleanup leg but rejects an unacknowledged %s leg",
    async (failedLeg) => {
      library.signOut.mockClear();
      library.signOut.mockImplementation(async () => {
        if (failedLeg === "signout") throw new Error("signout failed");
        return { url: "/login" };
      });
      const fetch = vi.fn(async (url: string) => {
        const leg = url === "/api/auth/attempt" ? "cancel" : "backend";
        return new Response(null, { status: leg === failedLeg ? 503 : 204 });
      });
      vi.stubGlobal("fetch", fetch);
      await expect(authApi.logout()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(library.signOut).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[1][0]).toMatch(/auth\/logout$/);
    },
  );
  it("never calls Credentials if start fails or logout intent arrives while start settles", async () => {
    library.signIn.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    await expect(authApi.login("email", "password")).rejects.toThrow();
    expect(library.signIn).not.toHaveBeenCalled();
    let active = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active = false;
        return new Response('{"ok":true}');
      }),
    );
    await expect(
      authApi.login("email", "password", () => active),
    ).rejects.toMatchObject({ code: "AUTH_ATTEMPT_CANCELLED" });
    expect(library.signIn).not.toHaveBeenCalled();
  });
  it("uses library CSRF and form protocol for Google without navigating inside the adapter", async () => {
    library.getCsrfToken.mockResolvedValue("synthetic-csrf");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    expect(await authApi.googleStart()).toContain("accounts.google.com");
    expect(fetch.mock.calls[1][0]).toBe("/api/auth/signin/google");
    expect(fetch.mock.calls[1][1]).toMatchObject({
      credentials: "same-origin",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    expect(fetch.mock.calls[1][1].body.toString()).toBe(
      "csrfToken=synthetic-csrf&callbackUrl=%2Flogin%3Fcomplete%3D1&json=true",
    );
  });
  it("rejects a Google HTTP redirect without returning a navigation destination", async () => {
    library.getCsrfToken.mockResolvedValue("synthetic-csrf");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockImplementationOnce(async (_url, init) => {
        expect(init.redirect).toBe("error");
        throw new TypeError("Redirect disallowed");
      });
    vi.stubGlobal("fetch", fetch);
    await expect(authApi.googleStart()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
  it("does not submit Google after logout intent during library CSRF retrieval", async () => {
    let active = true;
    library.getCsrfToken.mockImplementation(async () => {
      active = false;
      return "synthetic";
    });
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetch);
    await expect(authApi.googleStart(() => active)).rejects.toMatchObject({
      code: "AUTH_ATTEMPT_CANCELLED",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not acknowledge a library signOut CSRF/error redirect as cookie clear", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () => new Response(null, { status: 204 })),
    );
    library.signOut.mockResolvedValue({ url: "/api/auth/signout?csrf=true" });
    await expect(authApi.logout()).rejects.toMatchObject({
      code: "LOGOUT_FAILED",
    });
  });
  it.each([
    "https://accounts.google.com.evil.test/o/oauth2/v2/auth",
    "http://accounts.google.com/o/oauth2/v2/auth",
    "https://accounts.google.com/other",
    "https://name:password@accounts.google.com/o/oauth2/v2/auth",
    "javascript:alert(1)",
  ])("rejects an unapproved redirect destination", (url) => {
    expect(() => googleAuthorizationUrl(url)).toThrow();
  });
  it("accepts the exact provider destination and preserves server parameters", () => {
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic&scope=openid+email+profile";
    expect(googleAuthorizationUrl(url)).toBe(url);
  });
  it("renders only safe local errors, never provider/raw backend text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "INVALID_CREDENTIALS",
              message: "raw-secret-must-not-render",
            },
          }),
          { status: 401 },
        ),
      ),
    );
    let received: unknown;
    try {
      await authApi.login("test", "test");
    } catch (error) {
      received = error;
    }
    expect(authErrorMessage(received)).toBe("Incorrect email or password.");
    expect(
      authErrorMessage(new Error("raw-secret-must-not-render")),
    ).not.toContain("raw-secret");
    expect(authErrorMessage(new AuthError("UNKNOWN_RAW_CODE"))).not.toContain(
      "UNKNOWN_RAW_CODE",
    );
  });
  it("rejects stale non-Member success from session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...session,
            user: { ...session.user, id: null, membership: "guest" },
          }),
        ),
      ),
    );
    await expect(authApi.session()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("accepts registered Member identity after Google completion", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, expiresAt: session.expiresAt }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(session)));
    vi.stubGlobal("fetch", fetch);
    await authApi.complete();
    expect(await authApi.session()).toEqual(session);
    expect(fetch.mock.calls[0][0]).toBe("/api/auth/complete");
    expect(fetch.mock.calls[1][0]).toMatch(/\/auth\/session$/);
  });
  it.each([
    ["MEMBER_NOT_FOUND", 404],
    ["CANDIDATE_DENIED", 403],
    ["UNAUTHENTICATED", 401],
  ] as const)("preserves %s status and safe copy", async (code, status) => {
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
    await expect(authApi.complete()).rejects.toMatchObject({
      code,
      status,
    });
    if (code === "MEMBER_NOT_FOUND")
      expect(authErrorMessage(new AuthError(code, status))).toBe(
        "Your account is not registered in this system.",
      );
  });
  it("rejects malformed identity instead of granting a landing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { membership: "admin" },
            expiresAt: "invalid",
          }),
        ),
      ),
    );
    await expect(authApi.session()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
