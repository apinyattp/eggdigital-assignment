import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MeetingError,
  type Meeting,
} from "@/api/meetings";
import type { AuthSnapshot } from "./authController";
const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
}));
vi.mock("./authController", () => ({
  authController: {
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
  },
  initialAuthSnapshot: {},
}));
import { useMeetingLifecycle } from "./useMeetingLifecycle";
function identity(id = "owner"): AuthSnapshot {
  return {
    status: "authenticated",
    session: {
      user: {
        id,
        displayName: id,
        email: `${id}@example.test`,
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
const meeting: Meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Original",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  position: "Engineer",
  description: "General",
  preparationNotes: "Portfolio",
  startsAt: "2020-10-08T04:00:00.000123Z",
  endsAt: "2020-10-08T05:00:00.000124Z",
  status: "REJECTED",
  format: "ONSITE",
  location: null,
  attendees: [
    { memberId: null, displayName: "Guest", email: "guest@example.test" },
  ],
  createdAt: "2020-10-07T00:00:00Z",
  updatedAt: "2026-10-08T04:00:00.000123Z",
};
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
});
describe("creator Cancel/Delete confirmation and reconciliation", () => {
  it("does not read until an action is selected; dismissing confirmation makes no mutation", async () => {
    const api = {
      read: vi.fn().mockResolvedValue(meeting),
      cancel: vi.fn(),
      delete: vi.fn(),
    };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(api.read).not.toHaveBeenCalled();
    await act(async () => result.current.prepare("delete", "owner"));
    expect(result.current.phase).toBe("confirm");
    act(() => result.current.close());
    expect(result.current.phase).toBe("idle");
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.cancel).not.toHaveBeenCalled();
  });
  it("cancels a past Rejected meeting with exact version, then reads persisted data", async () => {
    const cancelled = { ...meeting, status: "CANCELLED" as const },
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockResolvedValueOnce(cancelled),
        cancel: vi.fn().mockResolvedValue(cancelled),
        delete: vi.fn(),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("cancel", "owner"));
    await act(async () => result.current.confirm());
    expect(api.cancel).toHaveBeenCalledWith(meeting.id, meeting.updatedAt);
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("complete");
    expect(result.current.meeting?.attendees).toEqual(meeting.attendees);
  });
  it("retries only GET after acknowledged cancellation and failed readback", async () => {
    const cancelled = { ...meeting, status: "CANCELLED" as const },
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"))
          .mockResolvedValueOnce(cancelled),
        cancel: vi.fn().mockResolvedValue(cancelled),
        delete: vi.fn(),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("cancel", "owner"));
    await act(async () => result.current.confirm());
    expect(result.current.phase).toBe("readback-error");
    await act(async () => result.current.retry());
    expect(api.cancel).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe("complete");
  });
  it.each(["ONSITE", "ONLINE"] as const)("single-flights %s delete and completes only after the API resolves its204", async (format) => {
    const pending = deferred<void>(),
      api = {
        read: vi.fn().mockResolvedValue({ ...meeting, format, status: "CANCELLED" }),
        cancel: vi.fn(),
        delete: vi.fn().mockReturnValue(pending.promise),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("delete", "owner"));
    act(() => {
      void result.current.confirm();
      void result.current.confirm();
    });
    expect(api.delete).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe("saving");
    await act(async () => pending.resolve());
    expect(result.current.phase).toBe("complete");
    expect(api.delete).toHaveBeenCalledWith(meeting.id, meeting.updatedAt);
    expect(api.read).toHaveBeenCalledOnce();
  });
  it("unknown delete followed by404 becomes unavailable, not a claim of successful deletion", async () => {
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(meeting)
        .mockRejectedValueOnce(new MeetingError("MEETING_NOT_FOUND", 404)),
      cancel: vi.fn(),
      delete: vi.fn().mockRejectedValue(new MeetingError("NETWORK_ERROR")),
    };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("delete", "owner"));
    await act(async () => result.current.confirm());
    expect(result.current.phase).toBe("unknown");
    await act(async () => result.current.retry());
    expect(result.current.phase).toBe("unavailable");
    expect(result.current.meeting).toBeNull();
    expect(api.delete).toHaveBeenCalledOnce();
  });
  it.each([409, 503])(
    "after delete%s requires latest review and a fresh explicit confirmation before another POST",
    async (status) => {
      const latest = {
          ...meeting,
          title: "Changed elsewhere",
          updatedAt: "2026-10-08T04:00:00.000124Z",
        },
        api = {
          read: vi
            .fn()
            .mockResolvedValueOnce(meeting)
            .mockResolvedValueOnce(latest),
          cancel: vi.fn(),
          delete: vi
            .fn()
            .mockRejectedValueOnce(
              new MeetingError(
                status === 409 ? "STALE_MEETING" : "DEPENDENCY_UNAVAILABLE",
                status,
              ),
            )
            .mockResolvedValueOnce(undefined),
        };
      const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
      await waitFor(() => expect(result.current.visible).toBe(true));
      await act(async () => result.current.prepare("delete", "owner"));
      await act(async () => result.current.confirm());
      await act(async () => result.current.retry());
      expect(result.current.phase).toBe("reconcile");
      expect(api.delete).toHaveBeenCalledOnce();
      act(() => result.current.reviewLatest());
      expect(result.current.phase).toBe("confirm");
      expect(api.delete).toHaveBeenCalledOnce();
      await act(async () => result.current.confirm());
      expect(api.delete).toHaveBeenLastCalledWith(meeting.id, latest.updatedAt);
    },
  );
  it("waits for an interrupted write to settle before GET reconciliation and never POSTs on focus", async () => {
    const pending = deferred<void>(),
      api = {
        read: vi.fn().mockResolvedValue(meeting),
        cancel: vi.fn(),
        delete: vi.fn().mockReturnValue(pending.promise),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("delete", "owner"));
    act(() => {
      void result.current.confirm();
      emit({ ...identity(), status: "checking", session: null });
    });
    expect(result.current.visible).toBe(false);
    act(() => emit(identity()));
    expect(result.current.phase).toBe("unknown");
    await act(async () => result.current.retry());
    expect(api.read).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    expect(result.current.phase).toBe("unknown");
    await act(async () => result.current.retry());
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(api.delete).toHaveBeenCalledOnce();
  });
  it("suppresses completion after confirmed account change", async () => {
    const pending = deferred<void>(),
      api = {
        read: vi.fn().mockResolvedValue(meeting),
        cancel: vi.fn(),
        delete: vi.fn().mockReturnValue(pending.promise),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("delete", "owner"));
    act(() => {
      void result.current.confirm();
      emit(identity("other"));
    });
    await act(async () => pending.resolve());
    expect(result.current.owner).toBe("other");
    expect(result.current.phase).toBe("idle");
    expect(result.current.meeting).toBeNull();
  });
  it("does not let an old account-context delete unlock a newer pending delete", async () => {
    const old = deferred<void>(),
      current = deferred<void>(),
      api = {
        read: vi.fn().mockResolvedValue(meeting),
        cancel: vi.fn(),
        delete: vi
          .fn()
          .mockReturnValueOnce(old.promise)
          .mockReturnValueOnce(current.promise),
      };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => result.current.prepare("delete", "owner"));
    act(() => {
      void result.current.confirm();
      emit(identity("other"));
      emit(identity());
    });
    await act(async () => result.current.prepare("delete", "owner"));
    act(() => {
      void result.current.confirm();
      emit({ ...identity(), status: "checking", session: null });
      emit(identity());
    });
    expect(result.current.phase).toBe("unknown");
    await act(async () => old.resolve());
    expect(result.current.writePending).toBe(true);
    await act(async () => result.current.retry());
    expect(api.read).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve());
    expect(result.current.writePending).toBe(false);
    expect(api.delete).toHaveBeenCalledTimes(2);
  });
  it("makes no creator read or write for a different member", async () => {
    mock.snapshot = identity("other");
    const api = { read: vi.fn(), cancel: vi.fn(), delete: vi.fn() };
    const { result } = renderHook(() => useMeetingLifecycle(meeting.id, api));
    await act(async () => {
      await Promise.resolve();
      await result.current.prepare("delete", "owner");
    });
    expect(api.read).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(result.current.meeting).toBeNull();
  });
});
