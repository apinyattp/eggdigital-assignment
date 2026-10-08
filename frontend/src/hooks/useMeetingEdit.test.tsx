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
import { editFields, editPayload, useMeetingEdit } from "./useMeetingEdit";
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
  status: "CANCELLED",
  format: "ONSITE",
  location: null,
  meetingProvider: null,
  externalMeetingId: null,
  attendees: [
    { memberId: null, displayName: "Guest", email: "guest@example.test" },
    { memberId: "team", displayName: "Team", email: "team@example.test" },
  ],
  createdAt: "2020-10-07T00:00:00Z",
  updatedAt: "2026-10-08T04:00:00.000123Z",
};
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
});
describe("creator Edit/team state and exact recovery", () => {
  it("reconciles an uncertain historical Online cancellation with only a meeting read", async () => {
    const online: Meeting = { ...meeting, format: "ONLINE", meetingProvider: "ZOOM", externalMeetingId: "123", status: "CONFIRMED", joinUrl: "https://zoom.us/j/123" };
    const api = {
      read: vi.fn().mockResolvedValueOnce(online).mockResolvedValue({ ...online, status: "CANCELLED", joinUrl: null }),
      edit: vi.fn().mockRejectedValue(new MeetingError("NETWORK_ERROR")),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("status", "CANCELLED"));
    await act(async () => result.current.save());
    await act(async () => result.current.retry());
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(api.edit).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe("reconcile");
    act(() => result.current.resolve(false));
    expect(result.current.meeting?.status).toBe("CANCELLED");
    expect(result.current.draft?.joinUrl).toBe("");
  });
  it("permits Past/Cancelled detail/status edits without sending immutable schedule or unchanged fields", async () => {
    const saved = {
        ...meeting,
        title: "Changed",
        status: "CONFIRMED" as const,
        updatedAt: "2026-10-08T04:00:00.000124Z",
      },
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockResolvedValueOnce(saved),
        edit: vi.fn().mockResolvedValue(saved),
      };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      result.current.change("title", "Changed");
      result.current.change("status", "CONFIRMED");
    });
    await act(async () => result.current.save());
    expect(api.edit.mock.calls[0]).toEqual([
      meeting.id,
      {
        expectedUpdatedAt: meeting.updatedAt,
        title: "Changed",
        status: "CONFIRMED",
      },
    ]);
    expect(result.current.saved).toBe(true);
    expect(result.current.meeting?.startsAt).toBe(meeting.startsAt);
  });
  it("keeps unmodified Guest rows and sends explicit additions/removals atomically with fields", async () => {
    const api = {
      read: vi.fn().mockResolvedValue(meeting),
      edit: vi.fn().mockResolvedValue(meeting),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      result.current.change("description", "New");
      result.current.add({
        id: "new",
        displayName: "New",
        email: "new@example.test",
      });
      result.current.toggleRemoval("team@example.test");
    });
    await act(async () => result.current.save());
    expect(api.edit.mock.calls[0][1]).toEqual({
      expectedUpdatedAt: meeting.updatedAt,
      description: "New",
      attendeeChanges: {
        addMemberIds: ["new"],
        removeEmails: ["team@example.test"],
      },
    });
    expect(
      result.current.meeting?.attendees.find(
        (row) => row.email === "guest@example.test",
      )?.memberId,
    ).toBeNull();
  });
  it("blocks an empty resulting team and supports undoing Guest removal", async () => {
    const api = { read: vi.fn().mockResolvedValue(meeting), edit: vi.fn() };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      result.current.toggleRemoval("guest@example.test");
      result.current.toggleRemoval("team@example.test");
    });
    await act(async () => result.current.save());
    expect(api.edit).not.toHaveBeenCalled();
    expect(result.current.fields.attendeeChanges).toBeTruthy();
    act(() => result.current.toggleRemoval("guest@example.test"));
    expect(result.current.removals).toEqual(["team@example.test"]);
  });
  it("does not permit creator or existing Guest identity to be added again", async () => {
    const api = { read: vi.fn().mockResolvedValue(meeting), edit: vi.fn() };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      result.current.add({
        id: "owner",
        displayName: "Owner",
        email: "owner@example.test",
      });
      result.current.add({
        id: "now-member",
        displayName: "Guest",
        email: "guest@example.test",
      });
    });
    expect(result.current.additions).toEqual([]);
  });
  it("after unknown write, reads latest without a POST and requires explicit draft reconciliation", async () => {
    const latest = {
        ...meeting,
        position: "New server role",
        updatedAt: "2026-10-08T04:00:00.000124Z",
      },
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockResolvedValueOnce(latest),
        edit: vi
          .fn()
          .mockRejectedValue(new MeetingError("DEPENDENCY_UNAVAILABLE", 503)),
      };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("title", "My draft"));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("unknown");
    act(() => result.current.change("title", "Must stay locked"));
    expect(result.current.draft?.title).toBe("My draft");
    await act(async () => result.current.retry());
    expect(api.edit).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("reconcile");
    expect(result.current.saved).toBe(false);
    act(() => result.current.resolve(true));
    expect(result.current.meeting?.updatedAt).toBe(latest.updatedAt);
    expect(result.current.draft).toMatchObject({
      title: "My draft",
      position: "New server role",
    });
    expect(api.edit).toHaveBeenCalledTimes(1);
  });
  it("reads and explicitly resolves 409 without silently overwriting a newer version", async () => {
    const latest = {
        ...meeting,
        title: "Elsewhere",
        updatedAt: "2026-10-08T04:00:00.000124Z",
      },
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockResolvedValueOnce(latest),
        edit: vi.fn().mockRejectedValue(new MeetingError("STALE_MEETING", 409)),
      };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("title", "Draft"));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("conflict");
    await act(async () => result.current.save());
    expect(api.edit).toHaveBeenCalledOnce();
    await act(async () => result.current.loadLatest());
    act(() => result.current.resolve(false));
    expect(result.current.draft?.title).toBe("Elsewhere");
    expect(result.current.meeting?.updatedAt).toBe(latest.updatedAt);
    expect(api.edit).toHaveBeenCalledOnce();
  });
  it("after acknowledged save and failed readback, retries GET only", async () => {
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(meeting)
        .mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"))
        .mockResolvedValueOnce({ ...meeting, title: "Saved" }),
      edit: vi.fn().mockResolvedValue({ ...meeting, title: "Saved" }),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("title", "Saved"));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("readback-error");
    expect(result.current.saved).toBe(true);
    await act(async () => result.current.retry());
    expect(api.edit).toHaveBeenCalledOnce();
    expect(api.read).toHaveBeenCalledTimes(3);
    expect(result.current.draft?.title).toBe("Saved");
  });
  it("single-flights save and suppresses late completion after account switch", async () => {
    const pending = deferred<Meeting>(),
      api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(meeting)
          .mockRejectedValueOnce(new MeetingError("MEETING_NOT_FOUND", 404)),
        edit: vi.fn().mockReturnValue(pending.promise),
      };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.save();
      void result.current.save();
    });
    expect(api.edit).toHaveBeenCalledOnce();
    act(() => emit(identity("other")));
    await waitFor(() => expect(result.current.phase).toBe("denied"));
    await act(async () => pending.resolve(meeting));
    expect(result.current.meeting).toBeNull();
    expect(result.current.saved).toBe(false);
  });
  it("retains an uncertain draft through same-account L4 error and never POSTs on return", async () => {
    const api = {
      read: vi.fn().mockResolvedValue(meeting),
      edit: vi.fn().mockRejectedValue(new MeetingError("NETWORK_ERROR")),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("title", "Retain"));
    await act(async () => result.current.save());
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.draft).toBeNull();
    act(() => emit({ ...identity(), status: "error", session: null }));
    act(() => emit(identity()));
    expect(result.current.draft?.title).toBe("Retain");
    expect(result.current.phase).toBe("unknown");
    expect(api.edit).toHaveBeenCalledOnce();
    expect(api.read).toHaveBeenCalledOnce();
  });
  it("does not read creator data for a Guest or accept a different creator's DTO", async () => {
    mock.snapshot = {
      ...identity(),
      session: {
        ...identity().session!,
        user: { ...identity().session!.user, id: null, membership: "guest" as unknown as "member" },
      },
    };
    const api = {
      read: vi
        .fn()
        .mockResolvedValue({ ...meeting, creatorId: "someone-else" }),
      edit: vi.fn(),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.read).not.toHaveBeenCalled();
    act(() => emit(identity()));
    await waitFor(() => expect(result.current.phase).toBe("denied"));
    expect(result.current.meeting).toBeNull();
  });
  it("does not let an old account-context write unlock a newer pending save", async () => {
    const old = deferred<Meeting>(),
      current = deferred<Meeting>();
    const api = {
      read: vi.fn().mockResolvedValue(meeting),
      edit: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise),
    };
    const { result } = renderHook(() => useMeetingEdit(meeting.id, api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.save();
      emit(identity("other"));
    });
    await waitFor(() => expect(result.current.phase).toBe("denied"));
    act(() => emit(identity()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.save();
      emit({ ...identity(), status: "checking", session: null });
      emit(identity());
    });
    expect(result.current.phase).toBe("unknown");
    await act(async () => old.resolve(meeting));
    expect(result.current.writePending).toBe(true);
    const reads = api.read.mock.calls.length;
    await act(async () => result.current.retry());
    expect(api.read).toHaveBeenCalledTimes(reads);
    await act(async () => current.resolve(meeting));
    expect(result.current.writePending).toBe(false);
    expect(api.edit).toHaveBeenCalledTimes(2);
  });
  it("builds explicit blank-field clears without touching Preparation or schedule", () => {
    const draft = { ...editFields(meeting), description: "" };
    expect(editPayload(meeting, draft, [], []).payload).toEqual({
      expectedUpdatedAt: meeting.updatedAt,
      description: null,
    });
  });
});

describe("manual meeting link edit contract", () => {
  const online: Meeting = {
    ...meeting,
    format: "ONLINE",
    status: "PENDING",
    meetingProvider: null,
    externalMeetingId: null,
    joinUrl: "https://meeting.example.test/old",
  };
  it("preserves an omitted unchanged link and schedule", () => {
    expect(editPayload(online, editFields(online), [], []).payload).toEqual({
      expectedUpdatedAt: online.updatedAt,
    });
  });
  it("sends only the version and changed link", () => {
    const result = editPayload(
      online,
      { ...editFields(online), joinUrl: " https://meeting.example.test/new " },
      [],
      [],
    );
    expect(result.fields).toEqual({});
    expect(result.payload).toEqual({
      expectedUpdatedAt: online.updatedAt,
      joinUrl: "https://meeting.example.test/new",
    });
  });
  it.each(["", "http://meeting.example.test/room"])(
    "rejects clearing or invalid changed link %s",
    (joinUrl) => {
      const result = editPayload(
        online,
        { ...editFields(online), joinUrl },
        [],
        [],
      );
      expect(result.fields.joinUrl).toBeTruthy();
      expect(result.payload).not.toHaveProperty("joinUrl");
    },
  );
});
