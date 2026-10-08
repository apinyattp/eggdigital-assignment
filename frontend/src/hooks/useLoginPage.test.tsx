import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "./authController";
const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  refresh: vi.fn(),
  callbackError: vi.fn(),
  replace: vi.fn(),
  snapshot: {
    status: "anonymous",
    session: null,
    pending: null,
    error: null,
    logoutRequired: false,
  } as AuthSnapshot,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("./authController", () => ({
  initialAuthSnapshot: mocks.snapshot,
  authController: {
    subscribe: () => () => undefined,
    getSnapshot: () => mocks.snapshot,
    complete: mocks.complete,
    refresh: mocks.refresh,
    callbackError: mocks.callbackError,
  },
}));
import { useLoginPage } from "./useLoginPage";
beforeEach(() => {
  mocks.complete.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/login");
});
describe("Login completion initialization (TEST-MM-041)", () => {
  it("captures and removes completion once even under StrictMode before any identity read", async () => {
    window.history.replaceState({}, "", "/login?complete=1");
    mocks.complete.mockImplementation(async () => {
      expect(window.location.search).toBe("");
    });
    renderHook(() => useLoginPage(), { wrapper: StrictMode });
    await act(async () => undefined);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it.each([
    "?complete=1&complete=1",
    "?complete=bad",
    "?authError=PROVIDER_CANCELLED",
  ])(
    "does not complete or overwrite error on invalid/error query %s",
    async (query) => {
      window.history.replaceState({}, "", `/login${query}`);
      renderHook(() => useLoginPage(), { wrapper: StrictMode });
      await act(async () => undefined);
      expect(mocks.callbackError).toHaveBeenCalledTimes(1);
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    },
  );
  it("ordinary reload reads L4 without trying to mint an API cookie from wrapper", async () => {
    renderHook(() => useLoginPage(), { wrapper: StrictMode });
    await act(async () => undefined);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
