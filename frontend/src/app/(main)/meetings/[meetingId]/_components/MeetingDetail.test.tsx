import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/hooks/authController";
import { MeetingError, type Meeting } from "@/api/meetings";
const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  read: vi.fn(),
  edit: vi.fn(),
  summaryEndsAt: "2020-10-08T04:00:00Z",
  cancel: vi.fn(),
  remove: vi.fn(),
  summaryStatus: "CONFIRMED",
  summaryFormat: "ONSITE",
  refreshSummary: vi.fn(),
  refreshFeedback: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/hooks/authController", () => ({
  authController: {
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
    refresh: vi.fn(),
  },
}));
vi.mock("@/hooks/useAuth", async () => {
  const { useSyncExternalStore } = await import("react");
  function useAuth() {
    return useSyncExternalStore(
      (listener) => {
        mock.listeners.add(listener);
        return () => mock.listeners.delete(listener);
      },
      () => mock.snapshot,
    );
  }
  return {
    useAuth,
    useCurrentIdentity: () => {
      const auth = useAuth();
      return {
        ...auth,
        checked: true,
        usableSession:
          auth.status === "authenticated" &&
          !auth.pending &&
          !auth.logoutRequired
            ? auth.session
            : null,
      };
    },
  };
});
vi.mock("@/api/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/meetings")>()),
  meetingsApi: {
    read: mock.read,
    edit: mock.edit,
    cancel: mock.cancel,
    delete: mock.remove,
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace }),
}));
vi.mock("@/hooks/useMeetingSummary", () => ({
  useMeetingSummary: () => ({
    phase: "ready",
    meeting: {
      id: "meeting",
      title: "Interview",
      candidate: { name: "Candidate" },
      position: "Engineer",
      startsAt: "2020-10-08T03:00:00Z",
      endsAt: mock.summaryEndsAt,
      status: mock.summaryStatus,
      format: mock.summaryFormat,
      joinUrl: "https://meeting.example.test/room",
      location: null,
      description: null,
      preparationNotes: "Portfolio",
      organizer: { id: "owner", displayName: "Owner" },
      attendeeCount: 0,
      attendees: [],
    },
    refresh: mock.refreshSummary,
  }),
}));
vi.mock("@/hooks/useInterviewNotes", () => ({
  useInterviewNotes: () => ({ phase: "ready" }),
}));
vi.mock("@/hooks/useMeetingFeedback", () => ({
  useMeetingFeedback: () => ({ phase: "ready", refresh: mock.refreshFeedback }),
}));
vi.mock("./InterviewNotes", () => ({
  InterviewNotes: () => <section>Notes presentation</section>,
}));
vi.mock("./MeetingFeedback", () => ({
  MeetingFeedback: () => <section>Feedback presentation</section>,
}));
import { MeetingDetail } from "./MeetingDetail";
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
    pending: null,
    logoutRequired: false,
    error: null,
  };
}
function emit(snapshot: AuthSnapshot) {
  mock.snapshot = snapshot;
  for (const listener of mock.listeners) listener();
}
const meeting: Meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Interview",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  position: "Engineer",
  description: null,
  preparationNotes: "Portfolio",
  startsAt: "2020-10-08T03:00:00Z",
  endsAt: "2020-10-08T04:00:00Z",
  status: "CONFIRMED",
  format: "ONSITE",
  location: null,
  attendees: [
    { memberId: null, displayName: "Guest", email: "guest@example.test" },
  ],
  createdAt: "2020-10-07T00:00:00Z",
  updatedAt: "2026-10-08T03:00:00.000123Z",
};
beforeEach(() => {
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.read.mockReset().mockResolvedValue(meeting);
  mock.edit.mockReset();
  mock.summaryEndsAt = meeting.endsAt;
  mock.cancel
    .mockReset()
    .mockResolvedValue({ ...meeting, status: "CANCELLED" });
  mock.remove.mockReset();
  mock.summaryStatus = "CONFIRMED";
  mock.summaryFormat = "ONSITE";
  mock.refreshSummary.mockReset();
  mock.refreshFeedback.mockReset();
  mock.replace.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
describe("Summary lifecycle mounting with the real mutation hook", () => {
  it.each(["ONSITE", "ONLINE"])(
    "shows Location only for Onsite and keeps a single Online Join action: %s",
    async (format) => {
      mock.summaryFormat = format;
      mock.summaryStatus = "CONFIRMED";
      render(<MeetingDetail meetingId="meeting" />);
      await screen.findByRole("heading", { name: "Meeting Info" });
      if (format === "ONLINE") {
        expect(
          screen.queryByText("Location", { exact: true }),
        ).not.toBeInTheDocument();
        const join = screen.getByRole("link", { name: "Join Meeting" });
        expect(join.closest("section")).toHaveAttribute(
          "aria-label",
          "Meeting actions",
        );
        expect(
          screen.getAllByRole("link", { name: "Join Meeting" }),
        ).toHaveLength(1);
        expect(join.parentElement).toContainElement(
          screen.getByRole("link", { name: "Edit Meeting" }),
        );
      } else {
        expect(screen.getByText("Location", { exact: true })).toBeVisible();
        expect(
          screen.queryByRole("link", { name: "Join Meeting" }),
        ).not.toBeInTheDocument();
      }
    },
  );
  it("keeps a historical cancelled Online meeting visible without external recovery actions", async () => {
    mock.summaryStatus = "CANCELLED";
    mock.summaryFormat = "ONLINE";
    render(<MeetingDetail meetingId="meeting" />);
    expect(
      await screen.findByRole("link", { name: /^Edit Meeting$/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "ตรวจผลการยกเลิกของฉัน" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Join Meeting" }),
    ).not.toBeInTheDocument();
    expect(mock.cancel).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it("mounts creator actions with date context and refreshes only Summary after Cancel", async () => {
    mock.read
      .mockResolvedValueOnce(meeting)
      .mockResolvedValueOnce({ ...meeting, status: "CANCELLED" });
    const user = userEvent.setup();
    render(<MeetingDetail meetingId="meeting" returnDate="2020-10-08" />);
    expect(
      await screen.findByRole("link", { name: /^Edit Meeting$/ }),
    ).toHaveAttribute("href", "/meetings/meeting/edit?date=2020-10-08");
    expect(
      screen.getByRole("link", { name: /^← All Meetings$/ }),
    ).toHaveAttribute("href", "/dashboard?date=2020-10-08");
    expect(mock.read).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Cancel Meeting$/ }));
    await user.click(
      await screen.findByRole("button", { name: /^Confirm Cancel$/ }),
    );
    await waitFor(() => expect(mock.refreshSummary).toHaveBeenCalledOnce());
    expect(mock.cancel).toHaveBeenCalledWith("meeting", meeting.updatedAt);
    expect(mock.refreshFeedback).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /^Delete Meeting$/ }),
    ).toBeEnabled();
  });
  it("retains an in-flight Delete across the parent's temporary identity-check return", async () => {
    let finish!: () => void;
    mock.remove.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<MeetingDetail meetingId="meeting" />);
    await user.click(
      await screen.findByRole("button", { name: /^Delete Meeting$/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^Confirm Delete$/ }),
    );
    act(() => emit({ ...identity(), status: "checking", session: null }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => emit(identity()));
    const reconcile = await screen.findByRole("button", {
      name: /^Waiting for the original request…$/,
    });
    expect(reconcile).toBeDisabled();
    await act(async () => finish());
    expect(
      await screen.findByRole("button", { name: /^Check latest details$/ }),
    ).toBeEnabled();
    expect(mock.remove).toHaveBeenCalledOnce();
    expect(mock.read).toHaveBeenCalledOnce();
    expect(mock.replace).not.toHaveBeenCalled();
  });
  it("keeps lifecycle controls and creator reads unavailable to another member", async () => {
    mock.snapshot = identity("other");
    render(<MeetingDetail meetingId="meeting" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.queryByRole("link", { name: /^Edit Meeting$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Delete Meeting$/ }),
    ).not.toBeInTheDocument();
    expect(mock.read).not.toHaveBeenCalled();
  });
});

describe("Detail creator status commands", () => {
  function futureMeeting() {
    const future = {
      ...meeting,
      status: "PENDING" as const,
      endsAt: "2099-10-08T04:00:00Z",
    };
    mock.summaryEndsAt = future.endsAt;
    mock.summaryStatus = future.status;
    mock.read.mockResolvedValue(future);
    return future;
  }
  it.each(["Confirm", "Reject"])(
    "saves only %s status with the current version and updates pressed state after readback",
    async (label) => {
      const initial = futureMeeting();
      const status = label === "Confirm" ? "CONFIRMED" : "REJECTED";
      const saved = {
        ...initial,
        status,
        updatedAt: "2030-10-08T04:00:00.000124Z",
      };
      mock.read.mockResolvedValueOnce(initial).mockResolvedValue(saved);
      mock.edit.mockResolvedValue(saved);
      const user = userEvent.setup();
      render(<MeetingDetail meetingId="meeting" />);
      const button = await screen.findByRole("button", { name: label });
      await user.click(button);
      await waitFor(() =>
        expect(button).toHaveAttribute("aria-pressed", "true"),
      );
      expect(mock.edit).toHaveBeenCalledExactlyOnceWith("meeting", {
        expectedUpdatedAt: initial.updatedAt,
        status,
      });
      expect(mock.refreshSummary).toHaveBeenCalledOnce();
      await user.click(button);
      expect(mock.edit).toHaveBeenCalledOnce();
    },
  );
  it("reads an uncertain result without repeating the status write", async () => {
    futureMeeting();
    mock.edit.mockRejectedValue(new MeetingError("NETWORK_ERROR"));
    const user = userEvent.setup();
    render(<MeetingDetail meetingId="meeting" />);
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await user.click(
      await screen.findByRole("button", { name: "Check saved status" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Use current status" }),
    );
    expect(mock.edit).toHaveBeenCalledOnce();
    expect(mock.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("retains a pending status write through a same-account check", async () => {
    const initial = futureMeeting();
    let finish!: (value: Meeting) => void;
    mock.edit.mockReturnValue(
      new Promise<Meeting>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<MeetingDetail meetingId="meeting" />);
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() => emit(identity()));
    expect(
      await screen.findByRole("button", { name: "Check saved status" }),
    ).toBeDisabled();
    await act(async () => finish({ ...initial, status: "CONFIRMED" }));
    expect(
      await screen.findByRole("button", { name: "Check saved status" }),
    ).toBeEnabled();
    expect(mock.edit).toHaveBeenCalledOnce();
  });
  it.each(["other", "past", "cancelled"])(
    "keeps status controls and reads unavailable for %s",
    async (condition) => {
      futureMeeting();
      if (condition === "other") mock.snapshot = identity("other");
      if (condition === "past") mock.summaryEndsAt = meeting.endsAt;
      if (condition === "cancelled") mock.summaryStatus = "CANCELLED";
      render(<MeetingDetail meetingId="meeting" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        screen.queryByRole("button", { name: "Confirm" }),
      ).not.toBeInTheDocument();
      expect(mock.read).not.toHaveBeenCalled();
      expect(mock.edit).not.toHaveBeenCalled();
    },
  );
});

describe("Detail status clock boundaries", () => {
  const start = Date.parse("2026-10-08T03:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
  });
  afterEach(() => vi.useRealTimers());
  async function mount(summaryEnd: number, editEnd = summaryEnd) {
    mock.summaryEndsAt = new Date(summaryEnd).toISOString();
    mock.summaryStatus = "PENDING";
    mock.read.mockResolvedValue({
      ...meeting,
      status: "PENDING",
      endsAt: new Date(editEnd).toISOString(),
    });
    const view = render(<MeetingDetail meetingId="meeting" />);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  }
  it.each(["summary", "edit"])(
    "expires at equality on the existing one-second tick for the %s end",
    async (source) => {
      const view = await mount(
        start + (source === "summary" ? 1000 : 5000),
        start + (source === "edit" ? 1000 : 5000),
      );
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
      act(() => vi.advanceTimersByTime(999));
      expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
      expect(mock.edit).not.toHaveBeenCalled();
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("rejects a click at an end between ticks, then hides controls on the next tick", async () => {
    await mount(start + 1500);
    act(() => vi.advanceTimersByTime(1499));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    act(() => vi.advanceTimersByTime(1));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(mock.edit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
  it("does not initialize status editing when mounted exactly at the summary end", async () => {
    await mount(start);
    expect(mock.read).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
  });
});
