import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetingList, MeetingListBatch } from "@/api/meetingList";
import type { MeetingSummary } from "@/api/meetingSummary";
import { MeetingError } from "@/api/meetings";
import { useMeetingList } from "./useMeetingList";
const date = "2026-10-08";
const item = (id: string): MeetingSummary => ({
  id,
  title: id,
  candidate: { name: id },
  position: "Engineer",
  description: null,
  preparationNotes: null,
  startsAt: "2026-10-08T03:00:00Z",
  endsAt: "2026-10-08T04:00:00Z",
  status: "CONFIRMED",
  format: "ONSITE",
  location: null,
  organizer: { id: "owner", displayName: "Owner" },
  attendees: [],
  attendeeCount: 0,
});
const initial = (): MeetingList => ({
  date,
  timeZone: "Asia/Bangkok",
  referenceTime: "2026-10-08T02:00:00Z",
  snapshot: "snapshot",
  groups: {
    upcomingCurrent: {
      total: 11,
      page: 1,
      pageSize: 10,
      items: [item("first")],
    },
    rejectedCancelled: { count: 12, items: [] },
    past: { count: 8, items: [] },
  },
});
const batch = (): MeetingListBatch => ({
  date,
  timeZone: "Asia/Bangkok",
  referenceTime: initial().referenceTime,
  snapshot: "snapshot",
  section: "upcomingCurrent",
  group: { total: 11, page: 2, pageSize: 10, items: [item("second")] },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe("R1 list date/account generations and continuation", () => {
  it("single-flights load more, appends once and keeps capped groups unchanged", async () => {
    const pending = deferred<MeetingListBatch>(),
      api = {
        read: vi.fn().mockResolvedValue(initial()),
        more: vi.fn().mockReturnValue(pending.promise),
      };
    const { result } = renderHook(() => useMeetingList(date, "member:a", api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    expect(api.more).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(batch()));
    expect(
      result.current.data?.groups.upcomingCurrent.items.map((item) => item.id),
    ).toEqual(["first", "second"]);
    expect(result.current.data?.groups.past.count).toBe(8);
    await act(async () => result.current.loadMore());
    expect(api.more).toHaveBeenCalledTimes(1);
  });
  it("preserves the same page/items on transient load-more failure", async () => {
    const api = {
      read: vi.fn().mockResolvedValue(initial()),
      more: vi
        .fn()
        .mockRejectedValueOnce(new MeetingError("DEPENDENCY_UNAVAILABLE", 503))
        .mockResolvedValueOnce(batch()),
    };
    const { result } = renderHook(() => useMeetingList(date, "member:a", api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.loadMore());
    expect(result.current.moreError).toBe(true);
    expect(result.current.data?.groups.upcomingCurrent.items).toHaveLength(1);
    await act(async () => result.current.loadMore());
    expect(api.more.mock.calls.map((args) => args.slice(0, 2))).toEqual([
      [date, 2],
      [date, 2],
    ]);
  });
  it.each(["LIST_CHANGED", "INVALID_CURSOR"])(
    "resets all groups on %s without appending",
    async (code) => {
      const refreshed = initial();
      refreshed.groups.upcomingCurrent.items = [item("fresh")];
      const api = {
        read: vi
          .fn()
          .mockResolvedValueOnce(initial())
          .mockResolvedValueOnce(refreshed),
        more: vi
          .fn()
          .mockRejectedValue(
            new MeetingError(code, code === "LIST_CHANGED" ? 409 : 400),
          ),
      };
      const { result } = renderHook(() =>
        useMeetingList(date, "member:a", api),
      );
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => result.current.loadMore());
      expect(api.read).toHaveBeenCalledTimes(2);
      expect(
        result.current.data?.groups.upcomingCurrent.items.map(
          (item) => item.id,
        ),
      ).toEqual(["fresh"]);
    },
  );
  it.each(["date", "principal"])(
    "discards late initial response after %s changes",
    async (change) => {
      const pending = deferred<MeetingList>(),
        next = initial();
      next.groups.upcomingCurrent.items = [item("new-context")];
      const api = {
        read: vi
          .fn()
          .mockReturnValueOnce(pending.promise)
          .mockResolvedValueOnce(next),
        more: vi.fn(),
      };
      const { result, rerender } = renderHook(
        ({ date, principal }) => useMeetingList(date, principal, api),
        { initialProps: { date, principal: "member:a" } },
      );
      await waitFor(() => expect(api.read).toHaveBeenCalledOnce());
      rerender({
        date: change === "date" ? "2026-10-09" : date,
        principal: change === "principal" ? "member:b" : "member:a",
      });
      expect(result.current.data).toBeNull();
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => pending.resolve(initial()));
      expect(result.current.data?.groups.upcomingCurrent.items[0].id).toBe(
        "new-context",
      );
    },
  );
  it.each([401, 403])(
    "clears private rows and counts after continuation denies access %s",
    async (status) => {
      const api = {
        read: vi.fn().mockResolvedValue(initial()),
        more: vi.fn().mockRejectedValue(new MeetingError("DENIED", status)),
      };
      const { result } = renderHook(() =>
        useMeetingList(date, "member:a", api),
      );
      await waitFor(() => expect(result.current.phase).toBe("ready"));
      await act(async () => result.current.loadMore());
      expect(result.current.data).toBeNull();
      expect(result.current.phase).toBe("denied");
      expect(result.current.accessError?.status).toBe(status);
    },
  );
  it("shows initial network failure as error rather than empty counts", async () => {
    const api = {
      read: vi.fn().mockRejectedValue(new MeetingError("NETWORK_ERROR")),
      more: vi.fn(),
    };
    const { result } = renderHook(() =>
      useMeetingList(date, "guest:a@example.test", api),
    );
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.data).toBeNull();
  });
  it("discards an old account's late continuation instead of appending it to the new account", async () => {
    const pending = deferred<MeetingListBatch>(),
      other = initial();
    other.groups.upcomingCurrent = {
      total: 1,
      page: 1,
      pageSize: 10,
      items: [item("other-account")],
    };
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(other),
      more: vi.fn().mockReturnValue(pending.promise),
    };
    const { result, rerender } = renderHook(
      ({ principal }) => useMeetingList(date, principal, api),
      { initialProps: { principal: "member:a" } },
    );
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => {
      void result.current.loadMore();
    });
    rerender({ principal: "member:b" });
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => pending.resolve(batch()));
    expect(
      result.current.data?.groups.upcomingCurrent.items.map((item) => item.id),
    ).toEqual(["other-account"]);
    expect(result.current.morePending).toBe(false);
  });
  it("reloads instead of combining a continuation with a different reference snapshot", async () => {
    const changedBatch = batch();
    changedBatch.referenceTime = "2026-10-08T02:01:00Z";
    const fresh = initial();
    fresh.groups.upcomingCurrent.items = [item("fresh-snapshot")];
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(fresh),
      more: vi.fn().mockResolvedValue(changedBatch),
    };
    const { result } = renderHook(() => useMeetingList(date, "member:a", api));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => result.current.loadMore());
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(
      result.current.data?.groups.upcomingCurrent.items.map((item) => item.id),
    ).toEqual(["fresh-snapshot"]);
  });
  it("refreshes from the server when a displayed meeting end crosses the reference time", async () => {
    vi.useFakeTimers();
    const first = initial();
    first.referenceTime = "2026-10-08T03:59:59Z";
    const api = { read: vi.fn().mockResolvedValue(first), more: vi.fn() };
    renderHook(() => useMeetingList(date, "member:a", api));
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.read).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1002);
    });
    expect(api.read).toHaveBeenCalledTimes(2);
  });
  it("starts a changed-day request immediately but holds a fast result for 220ms", async () => {
    vi.useFakeTimers();
    const api = { read: vi.fn().mockResolvedValue(initial()), more: vi.fn() };
    const { result, rerender } = renderHook(
      ({ selected }) => useMeetingList(selected, "member:a", api),
      { initialProps: { selected: date } },
    );
    await act(async () => {});
    expect(result.current.phase).toBe("ready");
    rerender({ selected: "2026-10-09" });
    await act(async () => {});
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("loading");
    expect(result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(219);
    });
    expect(result.current.phase).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.phase).toBe("ready");
  });
  it("cancels pending visual results on account change and unmount", async () => {
    vi.useFakeTimers();
    const other = initial();
    other.groups.upcomingCurrent.items = [item("new-member")];
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(other),
      more: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ selected, principal }) => useMeetingList(selected, principal, api),
      { initialProps: { selected: date, principal: "member:a" } },
    );
    await act(async () => {});
    rerender({ selected: "2026-10-09", principal: "member:a" });
    await act(async () => {});
    expect(result.current.data).toBeNull();
    rerender({ selected: "2026-10-09", principal: "member:b" });
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });
    expect(result.current.data?.groups.upcomingCurrent.items[0].id).toBe(
      "new-member",
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not delay slow date results or access denial", async () => {
    vi.useFakeTimers();
    const response = deferred<MeetingList>();
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(initial())
        .mockReturnValueOnce(response.promise)
        .mockRejectedValueOnce(new MeetingError("DENIED", 403)),
      more: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ selected }) => useMeetingList(selected, "member:a", api),
      { initialProps: { selected: date } },
    );
    await act(async () => {});
    rerender({ selected: "2026-10-09" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => response.resolve(initial()));
    expect(result.current.phase).toBe("ready");
    rerender({ selected: "2026-10-10" });
    await act(async () => {});
    expect(result.current.phase).toBe("denied");
    expect(result.current.data).toBeNull();
  });
  it("keeps only the newest date when another date arrives during the minimum display", async () => {
    vi.useFakeTimers();
    const newest = initial();
    newest.groups.upcomingCurrent.items = [item("newest-date")];
    const api = {
      read: vi
        .fn()
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(initial())
        .mockResolvedValueOnce(newest),
      more: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ selected }) => useMeetingList(selected, "member:a", api),
      { initialProps: { selected: date } },
    );
    await act(async () => {});
    rerender({ selected: "2026-10-09" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender({ selected: "2026-10-10" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(result.current.phase).toBe("loading");
    expect(result.current.data).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.data?.groups.upcomingCurrent.items[0].id).toBe(
      "newest-date",
    );
  });
});
