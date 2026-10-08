import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "./authController";
import { MemberLookupError, type MemberPage } from "@/api/members";
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
import { useMemberPicker } from "./useMemberPicker";
import { TeamPicker } from "@/app/(main)/meetings/new/_components/TeamPicker";

const owner = {
  id: "owner",
  displayName: "Owner",
  email: "owner@example.test",
};
const one = { id: "one", displayName: "Member One", email: "one@example.test" };
const two = { id: "two", displayName: "Member Two", email: "two@example.test" };
function identity(id = "owner"): AuthSnapshot {
  return {
    status: "authenticated",
    session: {
      user: { ...owner, id, membership: "member" },
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
function deferred() {
  let resolve!: (value: MemberPage) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<MemberPage>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  mock.listeners.clear();
  mock.snapshot = identity();
});

afterEach(() => vi.useRealTimers());

async function startSearch(change: () => void) {
  act(change);
  await act(async () => vi.advanceTimersByTimeAsync(300));
}

describe("M1 picker state — mocked M1 and current identity", () => {
  it("updates input immediately and searches only after 300 ms without another keystroke", async () => {
    const api = {
      search: vi
        .fn()
        .mockResolvedValue({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
    };
    const { result, rerender } = renderHook(() => useMemberPicker(false, api));
    act(() => result.current.setQuery("m"));
    expect(result.current.query).toBe("m");
    expect(result.current.phase).toBe("loading");
    await act(async () => vi.advanceTimersByTimeAsync(299));
    expect(api.search).not.toHaveBeenCalled();
    act(() => result.current.setQuery("  member  "));
    expect(result.current.query).toBe("  member  ");
    await act(async () => vi.advanceTimersByTimeAsync(200));
    rerender();
    rerender();
    await act(async () => vi.advanceTimersByTimeAsync(99));
    expect(api.search).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(api.search).toHaveBeenCalledExactlyOnceWith(
      "member",
      1,
      expect.any(AbortSignal),
    );
    expect(result.current.items).toEqual([one]);
  });
  it("aborts the old request as soon as typing resumes and ignores results during the delay", async () => {
    const old = deferred();
    const api = {
      search: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue({
          items: [two],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("one"));
    const signal = api.search.mock.calls[0][2];
    act(() => result.current.setQuery("two"));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      old.resolve({
        items: [one],
        page: 1,
        pageSize: 20,
        total: 30,
        totalPages: 2,
      }),
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.phase).toBe("loading");
    expect(result.current.hasMore).toBe(false);
    expect(api.search).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(result.current.items).toEqual([two]);
  });
  it("cancels scheduled lookups on clear and unmount", async () => {
    const api = { search: vi.fn() };
    const { result, unmount } = renderHook(() => useMemberPicker(false, api));
    act(() => result.current.setQuery("one"));
    act(() => result.current.setQuery("  "));
    expect(result.current.query).toBe("  ");
    expect(result.current.phase).toBe("idle");
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(api.search).not.toHaveBeenCalled();
    act(() => result.current.setQuery("two"));
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(api.search).not.toHaveBeenCalled();
  });
  it.each([
    { ...identity(), status: "checking", session: null },
    {
      ...identity(),
      status: "anonymous",
      session: null,
      pending: "logout",
      logoutRequired: true,
    },
    identity("new-owner"),
    {
      ...identity(),
      status: "error",
      session: null,
      error: new AuthError("CANDIDATE_DENIED", 403),
    },
  ] as AuthSnapshot[])(
    "cancels scheduled lookups on identity change %s",
    async (next) => {
      const api = { search: vi.fn() };
      const { result } = renderHook(() => useMemberPicker(false, api));
      act(() => result.current.setQuery("member"));
      act(() => emit(next));
      act(() => emit(identity()));
      await act(async () => vi.advanceTimersByTimeAsync(300));
      expect(api.search).not.toHaveBeenCalled();
      expect(result.current.items).toEqual([]);
      expect(result.current.phase).toBe("idle");
    },
  );
  it("cancels scheduled search when locked and permits an immediate retry after unlocking", async () => {
    const api = {
      search: vi
        .fn()
        .mockResolvedValue({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
    };
    const { result, rerender } = renderHook(
      ({ locked }) => useMemberPicker(locked, api),
      { initialProps: { locked: false } },
    );
    act(() => result.current.setQuery("member"));
    rerender({ locked: true });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(api.search).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
    rerender({ locked: false });
    await act(async () => result.current.retry());
    expect(api.search).toHaveBeenCalledOnce();
    expect(result.current.items).toEqual([one]);
  });
  it.each([
    new AuthError("NETWORK_ERROR"),
    new AuthError("DEPENDENCY_UNAVAILABLE", 503),
  ])(
    "TQA-D01 hides then restores selected team after unresolved L4 %s",
    async (error) => {
      const api = {
        search: vi.fn().mockResolvedValue({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
      };
      const { result } = renderHook(() => useMemberPicker(false, api));
      await startSearch(() => result.current.setQuery("one"));
      act(() => result.current.select("one"));
      act(() => emit({ ...identity(), status: "checking", session: null }));
      act(() => emit({ ...identity(), status: "error", session: null, error }));
      expect(result.current.selected).toEqual([]);
      expect(result.current.items).toEqual([]);
      expect(result.current.query).toBe("");
      expect(result.current.disabled).toBe(true);
      act(() => {
        result.current.remove("one");
        result.current.setQuery("two");
      });
      expect(api.search).toHaveBeenCalledOnce();
      act(() => emit(identity()));
      expect(result.current.selected).toEqual([one]);
      expect(result.current.items).toEqual([]);
    },
  );
  it.each([
    new AuthError("CANDIDATE_DENIED", 403),
    new AuthError("UNAUTHENTICATED", 401),
  ])(
    "TQA-D01 clears selected team on authoritative denial %s",
    async (error) => {
      const api = {
        search: vi.fn().mockResolvedValue({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
      };
      const { result } = renderHook(() => useMemberPicker(false, api));
      await startSearch(() => result.current.setQuery("one"));
      act(() => result.current.select("one"));
      act(() => emit({ ...identity(), status: "error", session: null, error }));
      act(() => emit(identity()));
      expect(result.current.selected).toEqual([]);
      expect(result.current.query).toBe("");
    },
  );
  it("starts at zero; blank focus/query makes no lookup", () => {
    const api = { search: vi.fn() };
    const { result } = renderHook(() => useMemberPicker(false, api));
    act(() => result.current.setQuery("  "));
    expect(api.search).not.toHaveBeenCalled();
    expect(result.current.selected).toEqual([]);
  });
  it("suppresses stale responses even if transport ignores abort", async () => {
    const old = deferred(),
      latest = deferred();
    const api = {
      search: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(latest.promise),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("old"));
    await startSearch(() => result.current.setQuery("new"));
    await act(async () =>
      latest.resolve({
        items: [two],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    );
    await act(async () =>
      old.resolve({
        items: [one],
        page: 1,
        pageSize: 20,
        total: 30,
        totalPages: 2,
      }),
    );
    expect(result.current.items).toEqual([two]);
    expect(result.current.hasMore).toBe(false);
  });
  it("excludes creator/duplicates/selected, preserves selection on clear and supports removal", async () => {
    const api = {
      search: vi.fn().mockResolvedValue({
        items: [owner, one, one, two],
        page: 1,
        pageSize: 20,
        total: 4,
        totalPages: 1,
      }),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("member"));
    expect(result.current.items).toEqual([one, two]);
    act(() => {
      result.current.select("one");
      result.current.select("one");
    });
    expect(result.current.selected).toEqual([one]);
    await startSearch(() => result.current.setQuery("member"));
    expect(result.current.items).toEqual([two]);
    act(() => result.current.setQuery(""));
    expect(result.current.selected).toEqual([one]);
    expect(result.current.items).toEqual([]);
    act(() => result.current.remove("one"));
    expect(result.current.selected).toEqual([]);
  });
  it("lookup failure retains selected members and retries the same query", async () => {
    const api = {
      search: vi
        .fn()
        .mockResolvedValueOnce({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        })
        .mockRejectedValueOnce(new MemberLookupError("NETWORK_ERROR"))
        .mockResolvedValueOnce({
          items: [two],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        }),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("one"));
    act(() => result.current.select("one"));
    await startSearch(() => result.current.setQuery("two"));
    expect(result.current.phase).toBe("error");
    expect(result.current.selected).toEqual([one]);
    await act(async () => result.current.retry());
    expect(api.search.mock.calls.at(-1)?.slice(0, 2)).toEqual(["two", 1]);
    expect(result.current.items).toEqual([two]);
  });
  it("paginates with the page number, dedupes overlapping pages and retries failed pages", async () => {
    const api = {
      search: vi
        .fn()
        .mockResolvedValueOnce({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 30,
          totalPages: 2,
        })
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({
          items: [one, two],
          page: 2,
          pageSize: 20,
          total: 22,
          totalPages: 2,
        }),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("member"));
    await act(async () => result.current.loadMore());
    expect(result.current.items).toEqual([one]);
    expect(result.current.phase).toBe("error");
    await act(async () => result.current.retry());
    expect(api.search.mock.calls.at(-1)?.slice(0, 2)).toEqual(["member", 2]);
    expect(result.current.items).toEqual([one, two]);
    expect(result.current.hasMore).toBe(false);
    await act(async () => result.current.loadMore());
    expect(api.search).toHaveBeenCalledTimes(3);
  });
  it("selecting a member aborts an in-flight next page and keeps the query cleared", async () => {
    const pending = deferred();
    const api = {
      search: vi
        .fn()
        .mockResolvedValueOnce({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 30,
          totalPages: 2,
        })
        .mockReturnValueOnce(pending.promise),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("member"));
    act(() => result.current.loadMore());
    expect(api.search).toHaveBeenCalledTimes(2);
    const signal = api.search.mock.calls[1][2];
    act(() => result.current.select("one"));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      pending.resolve({
        items: [two],
        page: 2,
        pageSize: 20,
        total: 30,
        totalPages: 2,
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(result.current.selected).toEqual([one]);
    expect(result.current.query).toBe("");
    expect(result.current.items).toEqual([]);
    expect(result.current.phase).toBe("idle");
    expect(api.search).toHaveBeenCalledTimes(2);
  });
  it("clearing a query and unmount both suppress pending results", async () => {
    const pending = deferred();
    const afterClear = deferred();
    const api = {
      search: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockReturnValueOnce(afterClear.promise),
    };
    const { result, unmount } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("one"));
    act(() => result.current.setQuery(""));
    await act(async () =>
      pending.resolve({
        items: [one],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(result.current.items).toEqual([]);
    await startSearch(() => result.current.setQuery("two"));
    const signal = api.search.mock.calls.at(-1)?.[2];
    unmount();
    expect(signal.aborted).toBe(true);
  });
  it("logout and account switching discard former selections and late results", async () => {
    const pending = deferred();
    const api = {
      search: vi
        .fn()
        .mockResolvedValueOnce({
          items: [one],
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        })
        .mockReturnValueOnce(pending.promise),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("one"));
    act(() => result.current.select("one"));
    await startSearch(() => result.current.setQuery("two"));
    act(() =>
      emit({
        ...identity(),
        status: "anonymous",
        session: null,
        pending: "logout",
        logoutRequired: true,
      }),
    );
    expect(result.current.selected).toEqual([]);
    expect(result.current.disabled).toBe(true);
    act(() => emit(identity("new-owner")));
    await act(async () =>
      pending.resolve({
        items: [two],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    );
    expect(result.current.selected).toEqual([]);
    expect(result.current.items).toEqual([]);
    expect(result.current.query).toBe("");
  });
  it("same-account identity recheck hides search but preserves selection", async () => {
    const api = {
      search: vi.fn().mockResolvedValue({
        items: [one],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    };
    const { result } = renderHook(() => useMemberPicker(false, api));
    await startSearch(() => result.current.setQuery("one"));
    act(() => result.current.select("one"));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(result.current.selected).toEqual([]);
    act(() => emit(identity()));
    expect(result.current.selected).toEqual([one]);
  });
  it.each([401, 403])(
    "HTTP %s hides private state and requests authoritative L4 recheck",
    async (status) => {
      const api = {
        search: vi
          .fn()
          .mockRejectedValue(new MemberLookupError("DENIED", status)),
      };
      const { result } = renderHook(() => useMemberPicker(false, api));
      await startSearch(() => result.current.setQuery("one"));
      expect(result.current.disabled).toBe(true);
      expect(mock.refresh).toHaveBeenCalledOnce();
    },
  );
  it("locked or Guest picker cannot search or change selection", async () => {
    const api = {
      search: vi.fn().mockResolvedValue({
        items: [one],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
    };
    const { result, rerender } = renderHook(
      ({ locked }) => useMemberPicker(locked, api),
      { initialProps: { locked: false } },
    );
    await startSearch(() => result.current.setQuery("one"));
    act(() => result.current.select("one"));
    rerender({ locked: true });
    act(() => {
      result.current.remove("one");
      result.current.setQuery("two");
    });
    expect(result.current.selected).toEqual([one]);
    expect(api.search).toHaveBeenCalledTimes(1);
    act(() =>
      emit({
        ...identity(),
        session: {
          ...identity().session!,
          user: {
            ...owner,
            id: null,
            membership: "guest" as unknown as "member",
          },
        },
      }),
    );
    rerender({ locked: false });
    act(() => result.current.setQuery("two"));
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(result.current.selected).toEqual([]);
  });
});

describe("page-local TeamPicker — TEST-MM-043/044 keyboard and status", () => {
  it("announces zero, exposes busy state, selects with keyboard and closes with Escape", async () => {
    const pending = deferred();
    const api = { search: vi.fn().mockReturnValue(pending.promise) };
    function Harness() {
      return <TeamPicker picker={useMemberPicker(false, api)} />;
    }
    render(<Harness />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(api.search).not.toHaveBeenCalled();
    expect(
      screen.getByText("0 selected · excluding the organizer"),
    ).toBeVisible();
    fireEvent.change(input, { target: { value: "member" } });
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(input).toHaveValue("member");
    expect(api.search).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () =>
      pending.resolve({
        items: [owner, one, two],
        page: 1,
        pageSize: 20,
        total: 3,
        totalPages: 1,
      }),
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      document.getElementById(input.getAttribute("aria-activedescendant")!),
    ).toHaveTextContent("Member One");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      screen.getByText("1 selected · excluding the organizer"),
    ).toBeVisible();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "Remove Member One" }));
    expect(
      screen.getByText("0 selected · excluding the organizer"),
    ).toBeVisible();
  });
  it("shows lookup failure separately from no results and retries accessibly", async () => {
    const api = {
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 0,
        }),
    };
    function Harness() {
      return <TeamPicker picker={useMemberPicker(false, api)} />;
    }
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "none" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to search members.",
    );
    expect(
      screen.queryByText(/No available members found./),
    ).not.toBeInTheDocument();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Retry search" })),
    );
    expect(screen.getByText(/No available members found./)).toBeVisible();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("listbox", { name: "Company members" }),
    ).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
  it("focuses required-team error without inventing Save or field projection", () => {
    function Harness() {
      return (
        <TeamPicker
          picker={useMemberPicker()}
          error="เลือกผู้ร่วมสัมภาษณ์อย่างน้อย 1 คน โดยไม่นับผู้จัดนัด"
        />
      );
    }
    render(<Harness />);
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
