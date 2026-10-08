import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InterviewContentError,
  type InterviewNote,
} from "@/api/interviewContent";
import type { AuthSnapshot } from "./authController";
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
import { useInterviewNotes } from "./useInterviewNotes";
import { useMeetingFeedback } from "./useMeetingFeedback";
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
const original = {
  text: "Private note",
  updatedAt: "2026-10-08T04:00:00.000123Z",
};
const stored = {
  text: "  Updated private note  ",
  updatedAt: "2026-10-08T04:00:00.000124Z",
};
const api = () => ({
  readNote: vi.fn().mockResolvedValue(original),
  saveNote: vi.fn().mockResolvedValue(stored),
});
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.refresh.mockClear();
});
describe("N1/N2 private Notes state — REQ020 AC024/032, mocked API/auth", () => {
  it("reads own note then saves verbatim text with exact version and reads only N1 back", async () => {
    const service = api();
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change(stored.text));
    service.readNote.mockResolvedValue(stored);
    await act(async () => result.current.save());
    expect(service.saveNote).toHaveBeenCalledWith("meeting", {
      text: stored.text,
      expectedUpdatedAt: original.updatedAt,
    });
    expect(service.readNote).toHaveBeenCalledTimes(2);
    expect(result.current.note).toEqual(stored);
    expect(result.current.saved).toBe(true);
  });
  it("does not refresh Feedback when Notes saves on the same mounted page", async () => {
    const service = api();
    const feedback = {
      readFeedback: vi.fn().mockResolvedValue({
        items: [],
        ownFeedbackId: null,
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 0,
        asOf: "2026-10-08T06:00:00Z",
        snapshot: "snapshot",
      }),
      createFeedback: vi.fn(),
      editFeedback: vi.fn(),
    };
    const { result } = renderHook(() => ({
      notes: useInterviewNotes("meeting", service),
      feedback: useMeetingFeedback("meeting", feedback),
    }));
    await waitFor(() => expect(result.current.notes.phase).toBe("ready"));
    await waitFor(() => expect(result.current.feedback.phase).toBe("ready"));
    await act(async () => result.current.notes.save());
    expect(feedback.readFeedback).toHaveBeenCalledOnce();
  });
  it("allows an empty first note with null version", async () => {
    const service = api();
    service.readNote
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ text: "", updatedAt: stored.updatedAt });
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.save());
    expect(service.saveNote).toHaveBeenCalledWith("meeting", {
      text: "",
      expectedUpdatedAt: null,
    });
  });
  it("locks a double Save and suppresses late completion after unmount", async () => {
    const pending = deferred<InterviewNote>(),
      service = api();
    service.saveNote.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() =>
      useInterviewNotes("meeting", service),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.save();
      void result.current.save();
    });
    expect(service.saveNote).toHaveBeenCalledOnce();
    unmount();
    await act(async () => pending.resolve(stored));
    expect(service.readNote).toHaveBeenCalledOnce();
  });
  it("preserves same payload/version on 503 and does not permit changing unknown draft", async () => {
    const service = api();
    service.saveNote.mockRejectedValueOnce(
      new InterviewContentError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change(stored.text));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("unknown");
    act(() => result.current.change("must not replace pending"));
    expect(result.current.draft).toBe(stored.text);
    service.readNote.mockResolvedValue(stored);
    await act(async () => result.current.retry());
    expect(service.saveNote.mock.calls[1][1]).toBe(
      service.saveNote.mock.calls[0][1],
    );
    expect(result.current.saved).toBe(true);
  });
  it("retries only GET after successful POST and failed readback", async () => {
    const service = api();
    service.readNote
      .mockResolvedValueOnce(original)
      .mockRejectedValueOnce(new InterviewContentError("NETWORK_ERROR"))
      .mockResolvedValueOnce(stored);
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("readback-error");
    await act(async () => result.current.retry());
    expect(service.saveNote).toHaveBeenCalledOnce();
    expect(service.readNote).toHaveBeenCalledTimes(3);
  });
  it("keeps conflict draft, waits for explicit choice and preserves latest microsecond version", async () => {
    const service = api();
    service.saveNote.mockRejectedValueOnce(
      new InterviewContentError("NOTE_CHANGED", 409),
    );
    service.readNote
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(stored)
      .mockResolvedValue(stored);
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("My draft"));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("conflict");
    expect(service.readNote).toHaveBeenCalledOnce();
    await act(async () => result.current.loadLatest());
    expect(result.current.draft).toBe("My draft");
    expect(result.current.latest).toEqual(stored);
    expect(result.current.locked).toBe(true);
    act(() => result.current.resolve(true));
    expect(service.saveNote).toHaveBeenCalledOnce();
    await act(async () => result.current.save());
    expect(service.saveNote.mock.calls[1][1]).toEqual({
      text: "My draft",
      expectedUpdatedAt: stored.updatedAt,
    });
  });
  it("resumes an interrupted initial read after same-account verification and ignores the stale result", async () => {
    const initialRead = deferred<InterviewNote | null>(),
      resumedRead = deferred<InterviewNote | null>(),
      service = api();
    service.readNote
      .mockReturnValueOnce(initialRead.promise)
      .mockReturnValueOnce(resumedRead.promise);
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(service.readNote).toHaveBeenCalledOnce());
    const initialSignal = service.readNote.mock.calls[0][1] as AbortSignal;
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(initialSignal.aborted).toBe(true);
    expect(result.current.visible).toBe(false);
    act(() => emit(identity()));
    expect(service.readNote).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("loading");
    act(() => emit(identity()));
    expect(service.readNote).toHaveBeenCalledTimes(2);
    await act(async () => resumedRead.resolve(stored));
    expect(result.current.phase).toBe("ready");
    expect(result.current.draft).toBe(stored.text);
    await act(async () => initialRead.resolve(original));
    expect(result.current.note).toEqual(stored);
    expect(service.saveNote).not.toHaveBeenCalled();
  });
  it("waits for verified identity before resuming an initial read after a transient session error", async () => {
    const initialRead = deferred<InterviewNote | null>(),
      service = api();
    service.readNote.mockReturnValueOnce(initialRead.promise);
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(service.readNote).toHaveBeenCalledOnce());
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new Error("Session unavailable"),
      }),
    );
    expect(service.readNote).toHaveBeenCalledOnce();
    expect(result.current.visible).toBe(false);
    act(() => emit(identity()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(service.readNote).toHaveBeenCalledTimes(2);
  });
  it("keeps an actual initial read failure explicit across same-account verification", async () => {
    const service = api();
    service.readNote.mockRejectedValueOnce(
      new InterviewContentError("NETWORK_ERROR"),
    );
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(result.current.phase).toBe("error");
    expect(result.current.error).toBe("NETWORK_ERROR");
    expect(service.readNote).toHaveBeenCalledOnce();
    await act(async () => result.current.retry());
    expect(result.current.phase).toBe("ready");
    expect(service.readNote).toHaveBeenCalledTimes(2);
  });
  it("retains draft on same-account focus recheck without refetch and clears on changed identity", async () => {
    const service = api();
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change("Draft"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.draft).toBe("");
    act(() => emit(identity()));
    expect(result.current.draft).toBe("Draft");
    expect(service.readNote).toHaveBeenCalledOnce();
    service.readNote.mockResolvedValue(null);
    act(() => emit(identity("other")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.draft).toBe("");
  });
  it("retains the exact uncertain Notes payload through a transient L4 failure", async () => {
    const service = api();
    service.saveNote.mockRejectedValueOnce(
      new InterviewContentError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.change(stored.text));
    await act(async () => result.current.save());
    expect(result.current.phase).toBe("unknown");
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new Error("L4 unavailable"),
      }),
    );
    expect(result.current.visible).toBe(false);
    expect(result.current.draft).toBe("");
    act(() => emit(identity()));
    expect(result.current.draft).toBe(stored.text);
    expect(result.current.phase).toBe("unknown");
    service.readNote.mockResolvedValue(stored);
    await act(async () => result.current.retry());
    expect(service.saveNote.mock.calls[1][1]).toBe(
      service.saveNote.mock.calls[0][1],
    );
    expect(service.readNote).toHaveBeenCalledTimes(2);
  });
  it("keeps known-save recovery GET-only when identity recheck interrupts readback", async () => {
    const readback = deferred<InterviewNote | null>(),
      service = api();
    service.readNote
      .mockResolvedValueOnce(original)
      .mockReturnValueOnce(readback.promise)
      .mockResolvedValueOnce(stored);
    const { result } = renderHook(() => useInterviewNotes("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.save();
    });
    await waitFor(() => expect(result.current.phase).toBe("readback"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(result.current.phase).toBe("readback-error");
    await act(async () => readback.resolve(original));
    expect(result.current.phase).toBe("readback-error");
    await act(async () => result.current.retry());
    expect(service.saveNote).toHaveBeenCalledOnce();
    expect(service.readNote).toHaveBeenCalledTimes(3);
    expect(result.current.note).toEqual(stored);
  });
  it("discards old meeting reads and pending writes on account/meeting changes", async () => {
    const pending = deferred<InterviewNote | null>(),
      service = api();
    service.readNote
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(null);
    const { result, rerender } = renderHook(
      ({ id }) => useInterviewNotes(id, service),
      { initialProps: { id: "first" } },
    );
    await waitFor(() => expect(service.readNote).toHaveBeenCalledOnce());
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve(original));
    expect(result.current.note).toBeNull();
    expect(result.current.meetingId).toBe("second");
  });
  it.each([401, 403, 404])(
    "clears private note after access failure %s",
    async (status) => {
      const service = api();
      service.saveNote.mockRejectedValue(
        new InterviewContentError("DENIED", status),
      );
      const { result } = renderHook(() =>
        useInterviewNotes("meeting", service),
      );
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => result.current.save());
      expect(result.current.phase).toBe("denied");
      expect(result.current.note).toBeNull();
      expect(result.current.draft).toBe("");
    },
  );
});
