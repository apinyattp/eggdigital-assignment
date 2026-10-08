import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "./authController";
import { MeetingError, type Meeting } from "@/api/meetings";
import { AuthError } from "@/api/auth/authError";

const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  refresh: vi.fn().mockResolvedValue(undefined),
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
import {
  useMeetingCreate,
  type OnsiteDraft,
  type OnlineDraft,
} from "./useMeetingCreate";
const draft: OnsiteDraft = {
  title: "Interview",
  candidateName: "Candidate",
  candidateEmail: "candidate@example.test",
  position: "Engineer",
  startsAt: "2026-10-08T09:00:00+07:00",
  endsAt: "2026-10-09T11:00:00+07:00",
  attendeeMemberIds: ["member"],
  description: "  General description  ",
  preparationNotes: "  Bring portfolio  ",
};
const stored: Meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Stored title",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  position: "Engineer",
  startsAt: draft.startsAt,
  endsAt: draft.endsAt,
  attendees: [
    { memberId: "member", displayName: "Member", email: "member@example.test" },
  ],
  description: "Stored description",
  preparationNotes: "Stored preparation",
  status: "PENDING",
  format: "ONSITE",
  location: null,
  createdAt: "2026-10-08T01:00:00.000001Z",
  updatedAt: "2026-10-08T01:00:00.000001Z",
};
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
function emit(snapshot: AuthSnapshot) {
  mock.snapshot = snapshot;
  for (const listener of mock.listeners) listener();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const api = () => ({
  create: vi.fn().mockResolvedValue({ meeting: stored, created: true }),
  read: vi.fn().mockResolvedValue(stored),
});
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.refresh.mockClear();
});

describe("Online create uses the existing owner-bound request state", () => {
  const online: OnlineDraft = {
    ...draft,
    format: "ONLINE",
    joinUrl: "https://meeting.example.test/room",
  };
  it("uses only GET after acknowledged Online create when readback fails", async () => {
    const saved: Meeting = {
      ...stored,
      format: "ONLINE",
      joinUrl: online.joinUrl,
    };
    const service = api();
    service.create.mockResolvedValue({ meeting: saved, created: true });
    service.read
      .mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"))
      .mockResolvedValue(saved);
    const { result } = renderHook(() => useMeetingCreate(service));
    await act(async () => result.current.save(online));
    expect(result.current.phase).toBe("read-error");
    await act(async () => result.current.retry());
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.read).toHaveBeenCalledTimes(2);
    expect(result.current.meeting).toEqual(saved);
  });
});

describe("Add save state — S1 two-field amendment, mocked M2/M3/auth", () => {
  it.each([
    new AuthError("NETWORK_ERROR"),
    new AuthError("DEPENDENCY_UNAVAILABLE", 503),
    new AuthError("SERVER_ERROR", 500),
    new AuthError("INVALID_RESPONSE"),
    "DEPENDENCY_UNAVAILABLE",
  ])(
    "TQA-D01 preserves hidden unknown operation through unresolved L4 %s",
    async (error) => {
      const service = api();
      service.create.mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"));
      const { result } = renderHook(() => useMeetingCreate(service));
      await act(async () => result.current.save(draft));
      const original = service.create.mock.calls[0][0];
      act(() => emit({ ...identity(), status: "checking", session: null }));
      act(() => emit({ ...identity(), status: "error", session: null, error }));
      expect(result.current.phase).toBe("idle");
      expect(result.current.locked).toBe(true);
      expect(result.current.meeting).toBeNull();
      expect(result.current.fields).toEqual({});
      await act(async () => {
        await result.current.retry();
        await result.current.save({ ...draft, title: "Must not send" });
      });
      expect(service.create).toHaveBeenCalledOnce();
      act(() => emit(identity()));
      expect(result.current.phase).toBe("unknown");
      await act(async () => result.current.save(draft));
      expect(service.create).toHaveBeenCalledOnce();
      await act(async () => result.current.retry());
      expect(service.create.mock.calls[1][0]).toBe(original);
      expect(original).toMatchObject({
        ...draft,
        requestId: expect.any(String),
      });
      expect(result.current.phase).toBe("saved");
    },
  );
  it.each([
    { status: "anonymous", session: null, error: null },
    {
      status: "error",
      session: null,
      error: new AuthError("CANDIDATE_DENIED", 403),
    },
    {
      status: "error",
      session: null,
      error: new AuthError("UNAUTHENTICATED", 401),
    },
    {
      status: "error",
      session: null,
      error: new AuthError("NETWORK_ERROR"),
      logoutRequired: true,
    },
  ] as Partial<AuthSnapshot>[])(
    "TQA-D01 discards operation after confirmed loss of access %s",
    async (denial) => {
      const service = api();
      service.create.mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"));
      const { result } = renderHook(() => useMeetingCreate(service));
      await act(async () => result.current.save(draft));
      act(() => emit({ ...identity(), ...denial }));
      act(() => emit(identity()));
      expect(result.current.phase).toBe("idle");
      await act(async () => result.current.retry());
      expect(service.create).toHaveBeenCalledOnce();
      await act(async () => result.current.save(draft));
      expect(service.create.mock.calls[1][0].requestId).not.toBe(
        service.create.mock.calls[0][0].requestId,
      );
    },
  );
  it("TQA-D01 suppresses in-flight result through failed L4 and retries acknowledged readback only with GET", async () => {
    const pending = deferred<Meeting>();
    const service = api();
    service.read.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingCreate(service));
    let save: Promise<void> | undefined;
    act(() => {
      save = result.current.save(draft);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("reading");
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new AuthError("DEPENDENCY_UNAVAILABLE", 503),
      }),
    );
    await act(async () => {
      pending.resolve(stored);
      await save;
    });
    expect(result.current.meeting).toBeNull();
    act(() => emit(identity()));
    expect(result.current.phase).toBe("read-error");
    await act(async () => result.current.retry());
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.read).toHaveBeenCalledTimes(2);
    expect(result.current.meeting).toEqual(stored);
  });
  it("TQA-D02 terminal deleted operation never retries or creates a new key until a new Add instance", async () => {
    const service = api();
    service.create.mockRejectedValueOnce(
      new MeetingError("MEETING_DELETED", 410),
    );
    const first = renderHook(() => useMeetingCreate(service));
    await act(async () => first.result.current.save(draft));
    expect(first.result.current.phase).toBe("deleted");
    expect(first.result.current.locked).toBe(true);
    expect(first.result.current.meeting).toBeNull();
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new AuthError("NETWORK_ERROR"),
      }),
    );
    act(() => emit(identity()));
    expect(first.result.current.phase).toBe("deleted");
    await act(async () => {
      await first.result.current.retry();
      await first.result.current.save(draft);
    });
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.read).not.toHaveBeenCalled();
    first.unmount();
    const next = renderHook(() => useMeetingCreate(service));
    await act(async () => next.result.current.save(draft));
    expect(service.create.mock.calls[1][0].requestId).not.toBe(
      service.create.mock.calls[0][0].requestId,
    );
    expect(next.result.current.phase).toBe("saved");
  });
  it("locks synchronously against double Save and shows only stored GET representation", async () => {
    const pending = deferred<{ meeting: Meeting; created: boolean }>();
    const service = api();
    service.create.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useMeetingCreate(service));
    act(() => {
      void result.current.save(draft);
      void result.current.save(draft);
    });
    expect(service.create).toHaveBeenCalledOnce();
    expect(result.current.locked).toBe(true);
    expect(result.current.phase).toBe("saving");
    await act(async () =>
      pending.resolve({
        meeting: { ...stored, title: "POST representation" },
        created: true,
      }),
    );
    expect(service.read).toHaveBeenCalledWith("meeting");
    expect(result.current.meeting).toEqual(stored);
    expect(result.current.phase).toBe("saved");
    await act(async () => result.current.save(draft));
    expect(service.create).toHaveBeenCalledOnce();
  });
  it.each([
    new MeetingError("DEPENDENCY_UNAVAILABLE", 503),
    new MeetingError("NETWORK_ERROR"),
    new MeetingError("SERVER_ERROR", 500),
    new MeetingError("INVALID_RESPONSE", 201),
  ])("retains immutable key and both field values after %s", async (error) => {
    const service = api();
    service.create.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useMeetingCreate(service));
    const mutable = { ...draft, attendeeMemberIds: ["member"] };
    await act(async () => result.current.save(mutable));
    const original = service.create.mock.calls[0][0];
    expect(result.current.phase).toBe("unknown");
    expect(result.current.locked).toBe(true);
    mutable.description = "changed";
    mutable.preparationNotes = "changed prep";
    mutable.attendeeMemberIds.push("another");
    await act(async () => result.current.save(mutable));
    expect(service.create).toHaveBeenCalledOnce();
    await act(async () => result.current.retry());
    expect(service.create.mock.calls[1][0]).toBe(original);
    expect(original).toMatchObject({
      ...draft,
      requestId: expect.any(String),
      attendeeMemberIds: ["member"],
    });
    expect(result.current.phase).toBe("saved");
  });
  it("retries only GET after acknowledged Save and failed readback", async () => {
    const service = api();
    service.read.mockRejectedValueOnce(new MeetingError("NETWORK_ERROR"));
    const { result } = renderHook(() => useMeetingCreate(service));
    await act(async () => result.current.save(draft));
    expect(result.current.phase).toBe("read-error");
    expect(result.current.meeting).toBeNull();
    await act(async () => result.current.retry());
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.read).toHaveBeenCalledTimes(2);
    expect(result.current.meeting).toEqual(stored);
  });
  it("allows correction only after explicit 400 rejection with a fresh request identity", async () => {
    const service = api();
    service.create.mockRejectedValueOnce(
      new MeetingError("VALIDATION_ERROR", 400, {
        preparationNotes: "Invalid",
      }),
    );
    const { result } = renderHook(() => useMeetingCreate(service));
    await act(async () => result.current.save(draft));
    expect(result.current.locked).toBe(false);
    expect(result.current.fields).toEqual({ preparationNotes: "Invalid" });
    await act(async () =>
      result.current.save({ ...draft, preparationNotes: "Corrected" }),
    );
    expect(service.create.mock.calls[1][0].requestId).not.toBe(
      service.create.mock.calls[0][0].requestId,
    );
  });
  it("suppresses late results after logout and never retries under another identity", async () => {
    const pending = deferred<{ meeting: Meeting; created: boolean }>();
    const service = api();
    service.create.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useMeetingCreate(service));
    act(() => {
      void result.current.save(draft);
    });
    act(() =>
      emit({
        ...identity(),
        status: "anonymous",
        session: null,
        pending: "logout",
        logoutRequired: true,
      }),
    );
    act(() => emit(identity("other")));
    await act(async () => pending.resolve({ meeting: stored, created: true }));
    await act(async () => result.current.retry());
    expect(service.create).toHaveBeenCalledOnce();
    expect(service.read).not.toHaveBeenCalled();
    expect(result.current.meeting).toBeNull();
    expect(result.current.phase).toBe("idle");
  });
  it("preserves uncertain operation through same-account L4 recheck but discards late POST result", async () => {
    const pending = deferred<{ meeting: Meeting; created: boolean }>();
    const service = api();
    service.create.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingCreate(service));
    act(() => {
      void result.current.save(draft);
    });
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.locked).toBe(true);
    await act(async () => pending.resolve({ meeting: stored, created: true }));
    expect(service.read).not.toHaveBeenCalled();
    act(() => emit(identity()));
    expect(result.current.phase).toBe("unknown");
    await act(async () => result.current.retry());
    expect(service.create.mock.calls[1][0]).toBe(
      service.create.mock.calls[0][0],
    );
    expect(result.current.phase).toBe("saved");
  });
  it.each([401, 403])(
    "rechecks identity on %s without automatically re-POSTing",
    async (status) => {
      const service = api();
      service.create.mockRejectedValueOnce(new MeetingError("DENIED", status));
      const { result } = renderHook(() => useMeetingCreate(service));
      await act(async () => result.current.save(draft));
      expect(mock.refresh).toHaveBeenCalledOnce();
      expect(service.create).toHaveBeenCalledOnce();
      expect(result.current.phase).toBe("unknown");
    },
  );
  it("does not submit for Guest or render a result after unmount", async () => {
    const service = api();
    mock.snapshot = {
      ...identity(),
      session: {
        ...identity().session!,
        user: {
          id: null,
          displayName: "Guest",
          email: "guest@example.test",
          membership: "guest" as unknown as "member",
        },
      },
    };
    const guest = renderHook(() => useMeetingCreate(service));
    await act(async () => guest.result.current.save(draft));
    expect(service.create).not.toHaveBeenCalled();
    guest.unmount();
    mock.snapshot = identity();
    const pending = deferred<{ meeting: Meeting; created: boolean }>();
    service.create.mockReturnValue(pending.promise);
    const member = renderHook(() => useMeetingCreate(service));
    act(() => {
      void member.result.current.save(draft);
    });
    member.unmount();
    await act(async () => pending.resolve({ meeting: stored, created: true }));
    expect(service.read).not.toHaveBeenCalled();
  });
});
