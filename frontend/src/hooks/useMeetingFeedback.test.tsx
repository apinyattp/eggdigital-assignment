import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InterviewContentError,
  type Feedback,
  type FeedbackPage,
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
const other: Feedback = {
  id: "other-row",
  text: "Other feedback",
  author: { displayName: "Other" },
  isOwn: false,
  createdAt: "2026-10-08T04:00:00.000123Z",
  updatedAt: "2026-10-08T04:00:00.000123Z",
};
const own: Feedback = {
  ...other,
  id: "own-row",
  text: "Own feedback",
  author: { displayName: "Owner" },
  isOwn: true,
  createdAt: "2026-10-08T05:00:00.000123Z",
  updatedAt: "2026-10-08T05:00:00.000124Z",
};
const page = (
  items: Feedback[] = [other],
  ownFeedbackId: string | null = null,
  hasOlder: string | null = null,
  pageNumber = 1,
  total = hasOlder ? 51 : items.length,
): FeedbackPage => ({
  items,
  ownFeedbackId,
  page: pageNumber,
  pageSize: 50,
  total,
  totalPages: Math.ceil(total / 50),
  asOf: "2026-10-08T06:00:00Z",
  snapshot: "snapshot",
});
const api = () => ({
  readFeedback: vi.fn().mockResolvedValue(page()),
  createFeedback: vi.fn().mockResolvedValue({ feedback: own, created: true }),
  editFeedback: vi.fn().mockResolvedValue({
    ...own,
    text: "Edited own",
    updatedAt: "2026-10-08T05:00:00.000125Z",
  }),
});
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.refresh.mockClear();
});
describe("F1/F2/F3 state — AC024/025/038, mocked API/auth", () => {
  it("keeps the presentation model stable across parent renders and updates it for edits and identity checks", async () => {
    const service = api();
    const { result, rerender } = renderHook(() =>
      useMeetingFeedback("meeting", service),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    const ready = result.current;
    for (let tick = 0; tick < 10; tick++) {
      rerender();
      expect(result.current).toBe(ready);
    }
    act(() => ready.open());
    expect(result.current).not.toBe(ready);
    expect(result.current.editor?.phase).toBe("editing");
    act(() => result.current.change("New feedback"));
    expect(result.current.editor?.draft).toBe("New feedback");
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.visible).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.canAdd).toBe(false);
    act(() => emit(identity()));
    expect(result.current.items).toEqual([other]);
    expect(result.current.editor?.draft).toBe("New feedback");
    expect(service.readFeedback).toHaveBeenCalledOnce();
  });
  it("blocks Add from authoritative ownFeedbackId outside latest50 and permits loading own old entry", async () => {
    const service = api();
    service.readFeedback
      .mockResolvedValueOnce(page([other], own.id, "older"))
      .mockResolvedValueOnce(page([own], own.id, null, 2, 51));
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.canAdd).toBe(false);
    act(() => result.current.open());
    expect(result.current.editor).toBeNull();
    await act(async () => result.current.older());
    expect(result.current.items.map((item) => item.id)).toEqual([
      own.id,
      other.id,
    ]);
    act(() => result.current.open(own.id));
    expect(result.current.editor?.expectedUpdatedAt).toBe(own.updatedAt);
  });
  it("does not load latest on same-account focus/L4 checks or incidental rerender", async () => {
    const service = api();
    const { result, rerender } = renderHook(() =>
      useMeetingFeedback("meeting", service),
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.items).toEqual([]);
    act(() => emit(identity()));
    rerender();
    expect(result.current.items).toEqual([other]);
    expect(service.readFeedback).toHaveBeenCalledOnce();
    await act(async () => result.current.refresh());
    expect(service.readFeedback).toHaveBeenCalledTimes(2);
  });
  it("resumes an interrupted first load after the same member is verified again", async () => {
    const pending = deferred<FeedbackPage>(),
      service = api();
    service.readFeedback
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([]));
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(service.readFeedback).toHaveBeenCalledOnce());
    const firstSignal = service.readFeedback.mock.calls[0][3] as AbortSignal;

    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(firstSignal.aborted).toBe(true);
    expect(result.current.visible).toBe(false);
    act(() => emit(identity()));

    await waitFor(() => expect(service.readFeedback).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.canAdd).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => pending.resolve(page([own], own.id)));
    expect(result.current.items).toEqual([]);
    expect(result.current.ownFeedbackId).toBeNull();
  });

  it("waits through a transient auth error before resuming the unfinished first load", async () => {
    const pending = deferred<FeedbackPage>(),
      service = api();
    service.readFeedback.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(service.readFeedback).toHaveBeenCalledOnce());
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new Error("Session unavailable"),
      }),
    );
    expect(service.readFeedback).toHaveBeenCalledOnce();
    expect(result.current.visible).toBe(false);
    act(() => emit(identity()));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(service.readFeedback).toHaveBeenCalledTimes(2);
  });

  it("does not automatically retry a genuine initial API failure after a same-account check", async () => {
    const service = api();
    service.readFeedback.mockRejectedValueOnce(
      new InterviewContentError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(service.readFeedback).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("DEPENDENCY_UNAVAILABLE");
    await act(async () => result.current.retryLoad());
    expect(result.current.phase).toBe("ready");
  });

  it("keeps an interrupted refresh of an already loaded list explicit and preserves its draft", async () => {
    const pending = deferred<FeedbackPage>(),
      service = api();
    service.readFeedback
      .mockResolvedValueOnce(page())
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.refresh();
    });
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(service.readFeedback).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([other]);
    expect(result.current.error).toBe("READ_INTERRUPTED");
    act(() => result.current.open());
    act(() => result.current.change("Unsaved draft"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(result.current.editor?.draft).toBe("Unsaved draft");
    expect(service.readFeedback).toHaveBeenCalledTimes(2);
  });

  it("preserves older page/items on failure and deduplicates retried older results", async () => {
    const service = api();
    service.readFeedback
      .mockResolvedValueOnce(page([other], null, "cursor"))
      .mockRejectedValueOnce(
        new InterviewContentError("DEPENDENCY_UNAVAILABLE", 503),
      )
      .mockResolvedValueOnce(page([own, other, own], own.id, null, 2, 51));
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.older());
    expect(result.current.items).toEqual([other]);
    expect(result.current.page).toBe(1);
    expect(result.current.snapshot).toBe("snapshot");
    await act(async () => result.current.retryLoad());
    expect(service.readFeedback.mock.calls[2].slice(0, 2)).toEqual([
      "meeting",
      2,
    ]);
    expect(result.current.items).toEqual([own, other]);
  });
  it.each(["INVALID_CURSOR", "LIST_CHANGED"])(
    "does not automatically refresh latest after %s",
    async (code) => {
      const service = api();
      service.readFeedback
        .mockResolvedValueOnce(page([other], null, "expired"))
        .mockRejectedValueOnce(
          new InterviewContentError(code, code === "LIST_CHANGED" ? 409 : 400),
        )
        .mockResolvedValue(page([other, own], own.id));
      const { result } = renderHook(() =>
        useMeetingFeedback("meeting", service),
      );
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => result.current.older());
      expect(result.current.refreshRequired).toBe(true);
      expect(result.current.items).toEqual([other]);
      await act(async () => result.current.retryLoad());
      expect(service.readFeedback).toHaveBeenCalledTimes(2);
      await act(async () => result.current.refresh());
      expect(service.readFeedback.mock.calls[2].slice(1, 3)).toEqual([
        1,
        undefined,
      ]);
      expect(result.current.items).toEqual([other, own]);
    },
  );
  it("serializes older requests and hides error as error rather than false empty", async () => {
    const pending = deferred<FeedbackPage>(),
      service = api();
    service.readFeedback
      .mockResolvedValueOnce(page([other], null, "cursor"))
      .mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.older();
      void result.current.older();
    });
    expect(service.readFeedback).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(page([own], own.id, null, 2, 51)));
    expect(result.current.items).toEqual([own, other]);
  });
  it("adds only own returned DTO, immediately disables Add and never refreshes other-author latest", async () => {
    const service = api();
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change("  My draft  "));
    await act(async () => result.current.save());
    expect(service.createFeedback.mock.calls[0][1]).toMatchObject({
      text: "My draft",
      requestId: expect.any(String),
    });
    expect(service.readFeedback).toHaveBeenCalledOnce();
    expect(result.current.items).toEqual([other, own]);
    expect(result.current.canAdd).toBe(false);
    expect(result.current.editor).toBeNull();
  });
  it("keeps exact unknown-create payload through transient L4 failure and double Save", async () => {
    const service = api();
    service.createFeedback.mockRejectedValueOnce(
      new InterviewContentError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change("Draft"));
    await act(async () => {
      void result.current.save();
      void result.current.save();
    });
    expect(service.createFeedback).toHaveBeenCalledOnce();
    expect(result.current.editor?.phase).toBe("unknown");
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new Error("L4 unavailable"),
      }),
    );
    expect(result.current.editor).toBeNull();
    act(() => emit(identity()));
    expect(result.current.editor?.draft).toBe("Draft");
    act(() => result.current.change("must not replace pending"));
    await act(async () => result.current.retrySave());
    expect(service.createFeedback.mock.calls[1][1]).toBe(
      service.createFeedback.mock.calls[0][1],
    );
    expect(service.readFeedback).toHaveBeenCalledOnce();
  });
  it("edits only own row with opaque version, keeps ordering/created time and does not GET", async () => {
    const service = api();
    service.readFeedback.mockResolvedValue(page([own, other], own.id));
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open(other.id));
    expect(result.current.editor).toBeNull();
    act(() => result.current.open(own.id));
    act(() => result.current.change("  Edited own  "));
    await act(async () => result.current.save());
    expect(service.editFeedback).toHaveBeenCalledWith("meeting", own.id, {
      text: "Edited own",
      expectedUpdatedAt: own.updatedAt,
    });
    expect(service.readFeedback).toHaveBeenCalledOnce();
    expect(result.current.items.map((item) => item.id)).toEqual([
      own.id,
      other.id,
    ]);
    expect(result.current.items[0].createdAt).toBe(own.createdAt);
    expect(result.current.items[1]).toEqual(other);
  });
  it("rejects blank Feedback without a request or timestamp change", async () => {
    const service = api();
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change(" \n "));
    await act(async () => result.current.save());
    expect(service.createFeedback).not.toHaveBeenCalled();
    expect(result.current.editor?.error).toBe("TEXT_REQUIRED");
    expect(result.current.items).toEqual([other]);
  });
  it("reconciles FEEDBACK_EXISTS through explicit refresh and explicit choice before editing existing row", async () => {
    const service = api();
    service.createFeedback.mockRejectedValueOnce(
      new InterviewContentError("FEEDBACK_EXISTS", 409),
    );
    service.readFeedback
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([other, own], own.id));
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change("New draft"));
    await act(async () => result.current.save());
    expect(result.current.editor?.phase).toBe("conflict");
    expect(service.readFeedback).toHaveBeenCalledOnce();
    await act(async () => result.current.refresh());
    expect(result.current.editor?.draft).toBe("New draft");
    expect(service.editFeedback).not.toHaveBeenCalled();
    act(() => result.current.resolve(true));
    await act(async () => result.current.save());
    expect(service.editFeedback).toHaveBeenCalledWith("meeting", own.id, {
      text: "New draft",
      expectedUpdatedAt: own.updatedAt,
    });
    expect(service.createFeedback).toHaveBeenCalledOnce();
  });
  it("does not resolve a conflict from stale data after latest-refresh failure", async () => {
    const service = api();
    service.readFeedback
      .mockResolvedValueOnce(page([own], own.id))
      .mockRejectedValueOnce(new InterviewContentError("NETWORK_ERROR"));
    service.editFeedback.mockRejectedValueOnce(
      new InterviewContentError("FEEDBACK_CHANGED", 409),
    );
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open(own.id));
    act(() => result.current.change("Changed"));
    await act(async () => result.current.save());
    await act(async () => result.current.refresh());
    expect(result.current.refreshRequired).toBe(true);
    act(() => result.current.resolve(true));
    expect(result.current.editor?.phase).toBe("conflict");
  });
  it("clears prior context and ignores late latest response on meeting change", async () => {
    const pending = deferred<FeedbackPage>(),
      service = api();
    service.readFeedback
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(page([]));
    const { result, rerender } = renderHook(
      ({ id }) => useMeetingFeedback(id, service),
      { initialProps: { id: "first" } },
    );
    await waitFor(() => expect(service.readFeedback).toHaveBeenCalledOnce());
    rerender({ id: "second" });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve(page([own], own.id, null, 2, 51)));
    expect(result.current.items).toEqual([]);
    expect(result.current.ownFeedbackId).toBeNull();
  });
  it("drops an uncertain request on a confirmed different account and never retries it there", async () => {
    const service = api();
    service.createFeedback.mockRejectedValueOnce(
      new InterviewContentError("NETWORK_ERROR"),
    );
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change("Former draft"));
    await act(async () => result.current.save());
    act(() => emit(identity("other")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.retrySave());
    expect(service.createFeedback).toHaveBeenCalledOnce();
    expect(result.current.editor).toBeNull();
  });
  it("discards a late successful write after the account changes", async () => {
    const pending = deferred<{ feedback: Feedback; created: boolean }>(),
      service = api();
    service.createFeedback.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.open());
    act(() => result.current.change("Former account draft"));
    act(() => {
      void result.current.save();
    });
    expect(result.current.editor?.phase).toBe("saving");
    service.readFeedback.mockResolvedValue(page([]));
    act(() => emit(identity("new-owner")));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve({ feedback: own, created: true }));
    expect(result.current.items).toEqual([]);
    expect(result.current.ownFeedbackId).toBeNull();
    expect(result.current.editor).toBeNull();
    expect(result.current.saved).toBe(false);
    expect(service.createFeedback).toHaveBeenCalledOnce();
  });
  it("clears Feedback and editor after current meeting access is denied", async () => {
    const service = api();
    service.readFeedback
      .mockResolvedValueOnce(page([own], own.id))
      .mockRejectedValueOnce(
        new InterviewContentError("MEETING_NOT_FOUND", 404),
      );
    const { result } = renderHook(() => useMeetingFeedback("meeting", service));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.refresh());
    expect(result.current.phase).toBe("denied");
    expect(result.current.items).toEqual([]);
    expect(result.current.canAdd).toBe(false);
  });
});
