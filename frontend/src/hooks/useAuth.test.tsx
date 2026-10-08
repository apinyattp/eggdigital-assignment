import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "./authController";
const mocks = vi.hoisted(() => ({
  refresh: vi.fn().mockResolvedValue(undefined),
  snapshot: {
    status: "authenticated",
    session: {
      user: {
        id: "test",
        displayName: "Test",
        email: "test@example.test",
        membership: "member",
      },
      expiresAt: "2026-10-07T12:00:02Z",
    },
    error: null,
    pending: null,
    logoutRequired: false,
  } as AuthSnapshot,
}));
vi.mock("./authController", () => ({
  authController: {
    subscribe: () => () => undefined,
    getSnapshot: () => mocks.snapshot,
    refresh: mocks.refresh,
  },
  initialAuthSnapshot: mocks.snapshot,
}));
import { useCurrentIdentity } from "./useAuth";
beforeEach(() => {
  mocks.snapshot = {
    status: "authenticated",
    session: {
      user: {
        id: "test",
        displayName: "Test",
        email: "test@example.test",
        membership: "member",
      },
      expiresAt: "2026-10-07T12:00:02Z",
    },
    error: null,
    pending: null,
    logoutRequired: false,
  };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("current identity lifecycle (mocked controller)", () => {
  it("checks on mount, expiry and browser focus; removes listeners on unmount", async () => {
    const { result, unmount } = renderHook(() => useCurrentIdentity());
    await act(async () => undefined);
    expect(result.current.checked).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(4);
    unmount();
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.refresh).toHaveBeenCalledTimes(4);
  });
  it("does not disable an anonymous form by starting another read on window focus/pageshow", async () => {
    mocks.snapshot = { ...mocks.snapshot, status: "anonymous", session: null };
    renderHook(() => useCurrentIdentity());
    await act(async () => undefined);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("usable session for page views (mocked controller)", () => {
  it("waits for the initial check and preserves the original session object", async () => {
    let finishCheck!: () => void;
    const initialize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
    );
    const originalSession = mocks.snapshot.session;
    const { result, rerender } = renderHook(() =>
      useCurrentIdentity(initialize),
    );
    expect(result.current.checked).toBe(false);
    expect(result.current.usableSession).toBeNull();
    expect(result.current.session).toBe(originalSession);

    await act(async () => finishCheck());
    expect(result.current.usableSession).toBe(originalSession);
    rerender();
    expect(result.current.usableSession).toBe(originalSession);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["checking", "anonymous", "error", "redirecting"] as const)(
    "hides a cached session while status is %s",
    async (status) => {
      mocks.snapshot = { ...mocks.snapshot, status };
      const { result } = renderHook(() => useCurrentIdentity());
      await act(async () => undefined);
      expect(result.current.checked).toBe(true);
      expect(result.current.usableSession).toBeNull();
      expect(result.current.session).toBe(mocks.snapshot.session);
    },
  );

  it.each(["password", "google-start", "complete", "logout"] as const)(
    "hides a cached session during %s",
    async (pending) => {
      mocks.snapshot = { ...mocks.snapshot, pending };
      const { result } = renderHook(() => useCurrentIdentity());
      await act(async () => undefined);
      expect(result.current.usableSession).toBeNull();
      expect(result.current.pending).toBe(pending);
    },
  );

  it("hides the session while logout recovery is required", async () => {
    mocks.snapshot = { ...mocks.snapshot, logoutRequired: true };
    const { result } = renderHook(() => useCurrentIdentity());
    await act(async () => undefined);
    expect(result.current.usableSession).toBeNull();
    expect(result.current.logoutRequired).toBe(true);
    expect(result.current.session).toBe(mocks.snapshot.session);
  });

  it("keeps a missing session null even with authenticated status", async () => {
    mocks.snapshot = { ...mocks.snapshot, session: null };
    const { result } = renderHook(() => useCurrentIdentity());
    await act(async () => undefined);
    expect(result.current.usableSession).toBeNull();
  });
});
