import { describe, expect, it, vi } from "vitest";
import { AuthError, type AuthApi, type Session } from "@/api/auth/authApi";
import { createAuthController } from "./authController";

const member: Session = {
  user: {
    id: "synthetic-id",
    displayName: "Current member",
    email: "member@example.test",
    membership: "member",
  },
  expiresAt: "2099-01-01T00:00:00Z",
};
const otherMember: Session = {
  user: {
    id: "other-member-id",
    displayName: "Other member",
    email: "otherMember@example.test",
    membership: "member",
  },
  expiresAt: member.expiresAt,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(overrides: Partial<AuthApi> = {}) {
  const api = {
    session: vi.fn().mockResolvedValue(member),
    login: vi.fn().mockResolvedValue(member),
    complete: vi.fn().mockResolvedValue(undefined),
    googleStart: vi
      .fn()
      .mockResolvedValue(
        "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
      ),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const navigate = vi.fn();
  return { api, navigate, auth: createAuthController(api, navigate) };
}

// TEST-MM-041/049/050/052: controlled API promises, not real provider/BE verification.
describe("single-page auth response ordering (mocked API)", () => {
  it("reads current identity after password success instead of trusting login identity", async () => {
    const { auth, api } = setup({
      session: vi.fn().mockResolvedValue(otherMember),
    });
    await auth.login("member@example.test", " exact password ");
    expect(api.login).toHaveBeenCalledWith(
      "member@example.test",
      " exact password ",
      expect.any(Function),
    );
    expect(api.session).toHaveBeenCalledTimes(1);
    expect(auth.getSnapshot().session).toEqual(otherMember);
  });
  it("deduplicates submit while a mutation is unresolved", async () => {
    const wait = deferred<Session>();
    const { auth, api } = setup({ login: vi.fn(() => wait.promise) });
    const first = auth.login("first", "one");
    const second = auth.login("second", "two");
    await Promise.resolve();
    expect(first).toBe(second);
    expect(api.login).toHaveBeenCalledTimes(1);
    wait.resolve(member);
    await first;
  });
  it("discards a pre-login current identity response arriving after a new account", async () => {
    const old = deferred<Session>();
    const session = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue(otherMember);
    const { auth } = setup({ session });
    const stale = auth.refresh();
    await Promise.resolve();
    await auth.login("otherMember", "test");
    old.resolve(member);
    await stale;
    expect(auth.getSnapshot().session).toEqual(otherMember);
  });
  it("clears stale identity on 503 and can retry current identity", async () => {
    const session = vi
      .fn()
      .mockResolvedValueOnce(member)
      .mockRejectedValueOnce(new AuthError("DEPENDENCY_UNAVAILABLE", 503))
      .mockResolvedValue(otherMember);
    const { auth } = setup({ session });
    await auth.refresh();
    await auth.refresh();
    expect(auth.getSnapshot()).toMatchObject({
      status: "error",
      session: null,
    });
    await auth.refresh();
    expect(auth.getSnapshot().session).toEqual(otherMember);
  });
  it.each([401, 403])(
    "removes identity on current-session status %s",
    async (status) => {
      const { auth } = setup({
        session: vi
          .fn()
          .mockResolvedValueOnce(member)
          .mockRejectedValue(
            new AuthError(
              status === 403 ? "CANDIDATE_DENIED" : "UNAUTHENTICATED",
              status,
            ),
          ),
      });
      await auth.refresh();
      await auth.refresh();
      expect(auth.getSnapshot().session).toBeNull();
      expect(auth.getSnapshot().status).toBe(
        status === 401 ? "anonymous" : "error",
      );
    },
  );
  it("cancels password immediately then clears again only after its response settles", async () => {
    const wait = deferred<Session>();
    const { auth, api } = setup({ login: vi.fn(() => wait.promise) });
    const login = auth.login("member", "test");
    await Promise.resolve();
    const out = auth.logout();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(auth.getSnapshot()).toMatchObject({
      session: null,
      pending: "logout",
      logoutRequired: true,
    });
    wait.resolve(member);
    await Promise.all([login, out]);
    expect(api.logout).toHaveBeenCalledTimes(2);
    expect(api.session).not.toHaveBeenCalled();
    expect(auth.getSnapshot()).toMatchObject({
      session: null,
      logoutRequired: false,
      pending: null,
    });
  });
  it.each(["success", "cancelled"])(
    "cancels pending completion then final-clears after its %s response",
    async (result) => {
      const completion = deferred<void>();
      const finalClear = deferred<void>();
      const logout = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockReturnValueOnce(finalClear.promise);
      const { auth, api } = setup({
        complete: vi.fn(() => completion.promise),
        logout,
      });
      const login = auth.complete();
      await Promise.resolve();
      const out = auth.logout();
      await Promise.resolve();
      expect(logout).toHaveBeenCalledTimes(1);
      void auth.login("new", "blocked");
      if (result === "success") completion.resolve();
      else completion.reject(new AuthError("AUTH_ATTEMPT_CANCELLED", 409));
      await login;
      await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(2));
      expect(api.session).not.toHaveBeenCalled();
      expect(auth.getSnapshot()).toMatchObject({
        pending: "logout",
        session: null,
        logoutRequired: true,
      });
      finalClear.resolve();
      await out;
      expect(auth.getSnapshot()).toMatchObject({
        pending: null,
        session: null,
        logoutRequired: false,
      });
      expect(api.login).not.toHaveBeenCalled();
    },
  );
  it("holds logout intent when final clear fails; retry clears once and only then allows new login", async () => {
    const completion = deferred<void>();
    const logout = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new AuthError("NETWORK_ERROR"))
      .mockResolvedValue(undefined);
    const { auth, api } = setup({
      complete: vi.fn(() => completion.promise),
      logout,
    });
    const login = auth.complete();
    await Promise.resolve();
    const out = auth.logout();
    completion.resolve();
    await Promise.all([login, out]);
    expect(auth.getSnapshot()).toMatchObject({
      status: "error",
      session: null,
      logoutRequired: true,
    });
    await auth.login("blocked", "test");
    expect(api.login).not.toHaveBeenCalled();
    await auth.refresh();
    expect(api.session).not.toHaveBeenCalled();
    await auth.logout();
    expect(logout).toHaveBeenCalledTimes(3);
    await auth.login("new", "test");
    expect(api.login).toHaveBeenCalledTimes(1);
  });
  it("accepts acknowledged final cleanup after an early cancellation failure", async () => {
    const completion = deferred<void>();
    const logout = vi
      .fn()
      .mockRejectedValueOnce(new AuthError("NETWORK_ERROR"))
      .mockResolvedValue(undefined);
    const { auth } = setup({ complete: () => completion.promise, logout });
    const login = auth.complete();
    await Promise.resolve();
    const out = auth.logout();
    completion.resolve();
    await Promise.all([login, out]);
    expect(logout).toHaveBeenCalledTimes(2);
    expect(auth.getSnapshot()).toMatchObject({
      status: "anonymous",
      session: null,
      pending: null,
      error: null,
      logoutRequired: false,
    });
  });
  it("deduplicates repeated logout and discards old identity reads", async () => {
    const read = deferred<Session>();
    const clear = deferred<void>();
    const { auth, api } = setup({
      session: () => read.promise,
      logout: vi.fn(() => clear.promise),
    });
    const pendingRead = auth.refresh();
    await Promise.resolve();
    const out = auth.logout();
    expect(auth.logout()).toBe(out);
    clear.resolve();
    await out;
    read.resolve(member);
    await pendingRead;
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(auth.getSnapshot().session).toBeNull();
  });
  it("does not redirect to Google after logout intent during start", async () => {
    const start = deferred<string>();
    const { auth, navigate } = setup({ googleStart: () => start.promise });
    const pending = auth.googleStart();
    await Promise.resolve();
    const out = auth.logout();
    start.resolve("https://accounts.google.com/o/oauth2/v2/auth");
    await Promise.all([pending, out]);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("does not invent identity on provider or credential errors", async () => {
    const { auth, api, navigate } = setup({
      login: vi
        .fn()
        .mockRejectedValue(new AuthError("INVALID_CREDENTIALS", 401)),
      googleStart: vi
        .fn()
        .mockRejectedValue(new AuthError("GOOGLE_AUTH_UNAVAILABLE", 503)),
    });
    await auth.login("member", "wrong");
    expect(auth.getSnapshot()).toMatchObject({ session: null, pending: null });
    await auth.googleStart();
    expect(api.session).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.getSnapshot().session).toBeNull();
  });
});
