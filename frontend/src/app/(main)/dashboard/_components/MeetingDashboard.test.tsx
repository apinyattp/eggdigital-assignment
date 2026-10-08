import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingList } from "@/api/meetingList";
import type { Session } from "@/api/auth/authApi";
const mock = vi.hoisted(() => ({
  list: {
    phase: "ready",
    data: null as MeetingList | null,
    morePending: false,
    moreError: false,
    accessError: null,
    refresh: vi.fn(),
    loadMore: vi.fn(),
  },
  calls: vi.fn(),
}));
vi.mock("@/hooks/useMeetingList", () => ({
  useMeetingList: (date: string, principal: string) => {
    mock.calls(date, principal);
    return mock.list;
  },
}));
import { MeetingDashboard } from "./MeetingDashboard";
const user: Session["user"] = {
  id: "owner",
  displayName: "Owner",
  email: "owner@example.test",
  membership: "member",
};
function list(): MeetingList {
  const item = {
    id: "meeting",
    title: "Cross-day interview",
    candidate: { name: "Candidate" },
    position: "Engineer",
    description: null,
    preparationNotes: null,
    startsAt: "2026-10-08T16:00:00Z",
    endsAt: "2026-10-09T02:00:00Z",
    status: "CONFIRMED" as const,
    format: "ONSITE" as const,
    location: "Room",
    organizer: { id: "owner", displayName: "Owner" },
    attendees: [],
    attendeeCount: 0,
  };
  return {
    date: "2026-10-08",
    timeZone: "Asia/Bangkok",
    referenceTime: "2026-10-08T02:00:00Z",
    snapshot: "snapshot",
    groups: {
      upcomingCurrent: { total: 17, page: 1, pageSize: 10, items: [item] },
      rejectedCancelled: {
        count: 12,
        items: Array.from({ length: 5 }, (_, i) => ({
          ...item,
          id: `cancelled-${i}`,
          candidate: { name: `Cancelled ${i}` },
          status: i % 2 ? ("REJECTED" as const) : ("CANCELLED" as const),
        })),
      },
      past: {
        count: 11,
        items: Array.from({ length: 5 }, (_, i) => ({
          ...item,
          id: `past-${i}`,
          candidate: { name: `Past ${i}` },
        })),
      },
    },
  };
}
beforeEach(() => {
  mock.list = {
    phase: "ready",
    data: list(),
    morePending: false,
    moreError: false,
    accessError: null,
    refresh: vi.fn(),
    loadMore: vi.fn(),
  };
  mock.calls.mockClear();
  window.history.replaceState({}, "", "/dashboard");
});
describe("Dashboard current10/capped5 three-section UI", () => {
  it("omits the unapproved refresh control while retaining read-only error recovery", async () => {
    const events = userEvent.setup();
    const { rerender } = render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Refresh meetings" }),
    ).not.toBeInTheDocument();
    mock.list.phase = "error";
    mock.list.data = null;
    rerender(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    await events.click(screen.getByRole("button", { name: "Try again" }));
    expect(mock.list.refresh).toHaveBeenCalledOnce();
  });
  it("shows the three groups in order and only one load-more action", async () => {
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((node) => node.textContent),
    ).toEqual([
      "Thursday, 8 October 2026",
      "Upcoming / Current",
      "Cancelled / Rejected",
      "Past Meetings",
    ]);
    const combined = screen.getByRole("region", {
        name: "Cancelled / Rejected",
      }),
      past = screen.getByRole("region", { name: "Past Meetings" });
    expect(within(combined).getAllByRole("article")).toHaveLength(5);
    expect(within(combined).getByText(/Latest 5 of 12/)).toBeInTheDocument();
    expect(within(past).getByText(/Latest 5 of 11/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Load more$/ })).toHaveLength(
      1,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^Load more$/ }));
    expect(mock.list.loadMore).toHaveBeenCalledOnce();
  });
  it("preserves selected date in Summary links and shows cross-day end", () => {
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: "View Candidate meeting" }),
    ).toHaveAttribute("href", "/meetings/meeting?date=2026-10-08");
    expect(screen.getAllByText("9 Oct 2026").length).toBeGreaterThan(0);
  });
  it("week browse does not change selected day or query; selecting a day does", async () => {
    const events = userEvent.setup();
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    await events.click(screen.getByRole("button", { name: "Next Week" }));
    expect(mock.calls).toHaveBeenLastCalledWith("2026-10-08", "member:owner");
    expect(
      screen.getByText(/Selected date is outside this week/),
    ).toBeInTheDocument();
    await events.click(
      screen.getByRole("button", { name: "Monday, 12 October 2026" }),
    );
    expect(mock.calls).toHaveBeenLastCalledWith("2026-10-12", "member:owner");
    expect(window.location.search).toBe("?date=2026-10-12");
  });
  it("restores the URL date on return/session recheck instead of resetting to initial day", () => {
    window.history.replaceState({}, "", "/dashboard?date=2026-10-20");
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(mock.calls).toHaveBeenLastCalledWith("2026-10-20", "member:owner");
  });
  it("shows one whole-day empty message only when all three counts are zero", () => {
    const data = list();
    for (const group of Object.values(data.groups)) {
      if ("total" in group) group.total = 0;
      else group.count = 0;
      group.items = [];
    }

    mock.list.data = data;
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No interviews yet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Past Meetings" }),
    ).not.toBeInTheDocument();
  });
  it.each(["loading", "error", "denied"])(
    "does not present %s as empty or retain private cards",
    (phase) => {
      mock.list.phase = phase;
      mock.list.data = null;
      render(
        <MeetingDashboard
          user={user}
          initialDate="2026-10-08"
          onAccessError={vi.fn()}
        />,
      );
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
      expect(screen.queryByText("No interviews yet")).not.toBeInTheDocument();
    },
  );
  it("keeps the Member creation action and scoped list identity", () => {
    render(
      <MeetingDashboard
        user={user}
        initialDate="2026-10-08"
        onAccessError={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Add New Meeting/ }),
    ).toBeInTheDocument();
    expect(mock.calls).toHaveBeenLastCalledWith("2026-10-08", "member:owner");
  });
});
