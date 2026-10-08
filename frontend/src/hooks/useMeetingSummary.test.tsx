import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingError } from "@/api/meetings";
import type { MeetingSummary } from "@/api/meetingSummary";
import type { AuthSnapshot } from "./authController";
const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  refresh: vi.fn(),
}));
vi.mock("./authController", () => ({
  authController: {
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
    refresh: mock.refresh,
  },
  initialAuthSnapshot: {},
}));
import { useMeetingSummary } from "./useMeetingSummary";
function identity(id = "owner"): AuthSnapshot {
  return {
    status: "authenticated",
    session: {
      user: {
        id,
        displayName: "Owner",
        email: "owner@example.test",
        membership: "member",
      },
      expiresAt: "2099-01-01T00:00:00Z",
    },
    error: null,
    pending: null,
    logoutRequired: false,
  };
}
function emit(value: AuthSnapshot) {
  mock.snapshot = value;
  for (const listener of mock.listeners) listener();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const meeting: MeetingSummary = {
  id: "first",
  title: "Meeting",
  candidate: { name: "Candidate" },
  position: "Engineer",
  description: "General",
  preparationNotes: "Prepare",
  startsAt: "2026-10-08T04:00:00Z",
  endsAt: "2026-10-08T05:00:00Z",
  status: "CONFIRMED",
  format: "ONSITE",
  location: "Room",
  organizer: { id: "owner", displayName: "Owner" },
  attendees: [],
  attendeeCount: 0,
};
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.refresh.mockClear();
});
describe("Summary access state — current-access revalidation, mocked API/auth", () => {
  it("hides core details while identity is unverified and rereads on same-account return", async () => {
    const service = { read: vi.fn().mockResolvedValue(meeting) };
    const { result } = renderHook(() => useMeetingSummary("first", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.meeting).toBeNull();
    act(() => emit(identity()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(service.read).toHaveBeenCalledTimes(2);
  });
  it("does not expose an old account's late response after identity changes", async () => {
    const pending = deferred<MeetingSummary>(),
      service = {
        read: vi
          .fn()
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValueOnce({ ...meeting, title: "New account view" }),
      };
    const { result } = renderHook(() => useMeetingSummary("first", service));
    await waitFor(() => expect(service.read).toHaveBeenCalledOnce());
    act(() => emit(identity("other")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve(meeting));
    expect(result.current.meeting?.title).toBe("New account view");
  });
  it("discards old meeting response after navigation", async () => {
    const pending = deferred<MeetingSummary>(),
      service = {
        read: vi
          .fn()
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValueOnce({ ...meeting, id: "second" }),
      };
    const { result, rerender } = renderHook(
      ({ id }) => useMeetingSummary(id, service),
      { initialProps: { id: "first" } },
    );
    await waitFor(() => expect(service.read).toHaveBeenCalledOnce());
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve(meeting));
    expect(result.current.meeting?.id).toBe("second");
  });
  it.each([401, 403, 404])(
    "hides details on current access failure %s without a refresh loop",
    async (status) => {
      const service = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockRejectedValueOnce(new MeetingError("DENIED", status)),
      };
      const { result } = renderHook(() => useMeetingSummary("first", service));
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => result.current.refresh());
      expect(result.current.phase).toBe("denied");
      expect(result.current.meeting).toBeNull();
      expect(mock.refresh).not.toHaveBeenCalled();
      expect(service.read).toHaveBeenCalledTimes(2);
    },
  );
});
