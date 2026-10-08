import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/api/meetings";
import type { AuthSnapshot } from "@/hooks/authController";
const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  read: vi.fn(),
  edit: vi.fn(),
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
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mock.snapshot,
  useCurrentIdentity: () => ({
    ...mock.snapshot,
    checked: true,
    usableSession:
      mock.snapshot.status === "authenticated" &&
      !mock.snapshot.pending &&
      !mock.snapshot.logoutRequired
        ? mock.snapshot.session
        : null,
  }),
}));
vi.mock("@/api/meetings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/meetings")>()),
  meetingsApi: { read: mock.read, edit: mock.edit },
}));
vi.mock("@/hooks/useMemberPicker", () => ({
  useMemberPicker: () => ({
    query: "",
    items: [],
    selected: [],
    phase: "idle",
    hasMore: false,
    disabled: false,
    setQuery: vi.fn(),
    retry: vi.fn(),
    loadMore: vi.fn(),
  }),
}));
import { EditMeetingForm } from "./EditMeetingForm";
const meeting: Meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Interview",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  position: "Engineer",
  description: "General description",
  preparationNotes: "Portfolio",
  startsAt: "2020-10-08T16:00:00Z",
  endsAt: "2020-10-09T02:00:00Z",
  status: "CANCELLED",
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
  mock.read.mockReset().mockResolvedValue(meeting);
  mock.edit.mockReset().mockResolvedValue(meeting);
  mock.snapshot = {
    status: "authenticated",
    session: {
      user: {
        id: "owner",
        displayName: "Owner",
        email: "owner@example.test",
        membership: "member",
      },
      expiresAt: "2099-01-01T00:00:00Z",
    },
    pending: null,
    logoutRequired: false,
    error: null,
  };
});
describe("Edit route and team UI with actual draft hook", () => {
  it.each(["ONSITE", "ONLINE"] as const)("shows %s format without provider metadata", async (format) => {
    mock.read.mockResolvedValue({ ...meeting, format, status: "CONFIRMED", joinUrl: format === "ONLINE" ? "https://meeting.example.test/room" : null });
    render(<EditMeetingForm meetingId="meeting" />);
    const meetingType = await screen.findByLabelText("Meeting type");
    expect(meetingType).toHaveValue(format === "ONLINE" ? "Online" : "Onsite");
    expect(meetingType).toBeDisabled();
    if (format === "ONLINE") {
      expect(screen.getByLabelText("Meeting link")).toHaveValue("https://meeting.example.test/room");
    } else {
      expect(screen.queryByLabelText("Meeting link")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Location (optional)")).toBeInTheDocument();
    }
  });
  it("shows one error toast only on invalid Save, preserves field errors after dismiss and does not write", async () => {
    const events = userEvent.setup();
    render(<EditMeetingForm meetingId="meeting" />);
    const title = await screen.findByLabelText("Title", { exact: false });
    await events.clear(title);
    expect(
      screen.queryByText("Check 1 field before saving."),
    ).not.toBeInTheDocument();
    expect(mock.edit).not.toHaveBeenCalled();
    await events.click(screen.getByRole("button", { name: /^Save Meeting$/ }));
    expect(screen.getAllByText("Check 1 field before saving.")).toHaveLength(1);
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.queryByText(
        "Your entries are preserved. Correct the fields marked below.",
      ),
    ).not.toBeInTheDocument();
    await events.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(
      screen.queryByText("Check 1 field before saving."),
    ).not.toBeInTheDocument();
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("This field is required.")).toBeVisible();
    expect(mock.edit).not.toHaveBeenCalled();
    await events.click(screen.getByRole("button", { name: /^Save Meeting$/ }));
    expect(screen.getAllByText("Check 1 field before saving.")).toHaveLength(1);
  });
  it("hides creator fields while logout is pending despite a cached session", () => {
    mock.snapshot = { ...mock.snapshot, pending: "logout" };
    render(<EditMeetingForm meetingId="meeting" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only the meeting creator",
    );
    expect(
      screen.queryByLabelText("Title", { exact: false }),
    ).not.toBeInTheDocument();
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("shows immutable past cross-day schedule while allowing other fields/status and retaining Guest", async () => {
    render(<EditMeetingForm meetingId="meeting" returnDate="2020-10-08" />);
    await screen.findByLabelText("Candidate Name", { exact: false });
    expect(screen.getByLabelText("Start date", { exact: true })).toBeDisabled();
    expect(screen.getByLabelText("End date", { exact: true })).toBeDisabled();
    expect(
      screen.getByLabelText("Start time – End time", { exact: true }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Start date", { exact: true })).toHaveValue(
      "8 October 2020",
    );
    expect(screen.getByLabelText("End date", { exact: true })).toHaveValue(
      "9 October 2020",
    );
    expect(screen.getByLabelText("Status", { exact: true })).toBeEnabled();
    expect(
      screen.getByRole("option", { name: "Cancelled" }),
    ).toBeInTheDocument();
    expect(screen.getByText("guest@example.test · Guest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Cancel$/ })).toHaveAttribute(
      "href",
      "/meetings/meeting?date=2020-10-08",
    );
  });
  it("saves title without schedule/provider/Notes/Feedback or implicit Guest removal", async () => {
    const events = userEvent.setup();
    render(<EditMeetingForm meetingId="meeting" />);
    const title = await screen.findByLabelText("Title", { exact: false });
    await events.clear(title);
    await events.type(title, "Changed");
    await events.click(screen.getByRole("button", { name: /^Save Meeting$/ }));
    await waitFor(() =>
      expect(mock.edit).toHaveBeenCalledWith("meeting", {
        expectedUpdatedAt: meeting.updatedAt,
        title: "Changed",
      }),
    );
    await screen.findByText("Meeting changes saved.");
  });
  it("requires at least one resulting attendee and offers undo for a Guest removal", async () => {
    const events = userEvent.setup();
    render(<EditMeetingForm meetingId="meeting" />);
    await screen.findByText("guest@example.test · Guest");
    await events.click(screen.getByRole("button", { name: /^Remove Guest$/ }));
    await events.click(screen.getByRole("button", { name: /^Save Meeting$/ }));
    expect(mock.edit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /^Undo removal of Guest$/ }),
    ).toBeInTheDocument();
    await events.click(
      screen.getByRole("button", { name: /^Undo removal of Guest$/ }),
    );
    expect(
      screen.getByText("1 selected · excluding the organizer"),
    ).toBeInTheDocument();
  });
  it("does not mount creator fields for Guest access", () => {
    mock.snapshot = {
      ...mock.snapshot,
      session: {
        ...mock.snapshot.session!,
        user: { ...mock.snapshot.session!.user, id: null, membership: "guest" as unknown as "member" },
      },
    };
    render(<EditMeetingForm meetingId="meeting" />);
    expect(
      screen.queryByLabelText("Candidate Email", { exact: false }),
    ).not.toBeInTheDocument();
    expect(mock.read).not.toHaveBeenCalled();
  });
});
