import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "./authController";
import { AuthError } from "@/api/auth/authError";
import { MeetingError, meetingsApi, type Meeting } from "@/api/meetings";
import { membersApi } from "@/api/members";

const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  refresh: vi.fn().mockResolvedValue(undefined),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace }),
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
import { useMeetingCreateForm } from "./useMeetingCreateForm";
import { MeetingCreateForm } from "@/app/(main)/meetings/new/_components/MeetingCreateForm";
const member = {
  id: "member",
  displayName: "Member One",
  email: "member@example.test",
};
const stored: Meeting = {
  id: "meeting",
  creatorId: "owner",
  title: "Stored title",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  position: "Engineer",
  startsAt: "2030-01-01T02:00:00Z",
  endsAt: "2030-01-01T03:00:00Z",
  attendees: [
    {
      memberId: member.id,
      displayName: member.displayName,
      email: member.email,
    },
  ],
  description: "General details",
  preparationNotes: "Bring portfolio",
  status: "PENDING",
  format: "ONSITE",
  location: null,
  meetingProvider: null,
  externalMeetingId: null,
  createdAt: "2030-01-01T02:30:00Z",
  updatedAt: "2030-01-01T02:30:00Z",
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
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      }),
    },
    close: {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      }),
    },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-01T02:30:00Z"));
  mock.listeners.clear();
  mock.snapshot = identity();
  mock.refresh.mockClear();
  vi.spyOn(membersApi, "search").mockResolvedValue({
    items: [member],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.spyOn(meetingsApi, "create").mockResolvedValue({
    meeting: stored,
    created: true,
  });
  vi.spyOn(meetingsApi, "read").mockResolvedValue(stored);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function chooseDate(label: string, day: number) {
  fireEvent.click(screen.getByLabelText(new RegExp("^" + label)));
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp("\\b" + day + " January 2030$"),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Apply$/ }));
}
async function fillPage() {
  await act(async () => {
    render(<MeetingCreateForm />);
  });
  chooseDate("Start date", 1);
  chooseDate("End date", 1);
  for (const [label, value] of [
    ["Candidate Name", "Candidate"],
    ["Candidate Email", "candidate@example.test"],
    ["Position", "Engineer"],
    ["Title", "Draft title"],
    ["Description", "  General details  "],
    ["Preparation Notes", "  Bring portfolio  "],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp("^" + label)), {
      target: { value },
    });
  await act(async () => {
    fireEvent.change(
      screen.getByRole("combobox", { name: /Interview Teams Email/ }),
      { target: { value: "Member" } },
    );
  });
  fireEvent.click(await screen.findByRole("option", { name: /Member One/ }));
}
describe("TQA-D01/D02 Add page recovery — mocked HTTP, real form/picker hooks", () => {
  it("writes once only after explicit valid Save and then opens confirmed Detail", async () => {
    await fillPage();
    expect(meetingsApi.create).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Meeting" }));
    });
    expect(meetingsApi.create).toHaveBeenCalledOnce();
    expect(mock.replace).toHaveBeenCalledOnce();
    expect(mock.replace).toHaveBeenCalledWith("/meetings/meeting");
  });

  it("uses manual links without provider calls and preserves the draft across format changes", async () => {
    await fillPage();
    fireEvent.change(screen.getByLabelText("Meeting type"), {
      target: { value: "ONLINE" },
    });
    expect(screen.getByLabelText(/^Meeting link/)).toBeRequired();
    expect(
      screen.queryByRole("region", { name: "บัญชีสำหรับนัดออนไลน์" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Meeting link/), {
      target: { value: "https://meeting.example.test/room" },
    });
    fireEvent.change(screen.getByLabelText("Meeting type"), {
      target: { value: "ONSITE" },
    });
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Draft title");
    fireEvent.change(screen.getByLabelText("Meeting type"), {
      target: { value: "ONLINE" },
    });
    expect(screen.getByLabelText(/^Meeting link/)).toHaveValue(
      "https://meeting.example.test/room",
    );
    expect(meetingsApi.create).not.toHaveBeenCalled();
  });
  it("submits manual Online fields and retains its exact request after a network failure", async () => {
    await fillPage();
    fireEvent.change(screen.getByLabelText("Meeting type"), {
      target: { value: "ONLINE" },
    });
    fireEvent.change(screen.getByLabelText(/^Meeting link/), {
      target: { value: "https://meeting.example.test/room" },
    });
    vi.mocked(meetingsApi.create).mockRejectedValue(
      new MeetingError("NETWORK_ERROR"),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Meeting" }));
    });
    const payload = vi.mocked(meetingsApi.create).mock.calls[0][0];
    expect(payload).toMatchObject({
      format: "ONLINE",
      joinUrl: "https://meeting.example.test/room",
      preparationNotes: "  Bring portfolio  ",
      description: "  General details  ",
    });
    expect(payload).not.toHaveProperty("meetingProvider");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check save result again" }),
      );
    });
    expect(vi.mocked(meetingsApi.create).mock.calls[1][0]).toBe(payload);
    expect(meetingsApi.read).not.toHaveBeenCalled();
  });
  it("hides private UI while L4 fails, restores complete draft/team, and retries the exact unknown payload", async () => {
    vi.mocked(meetingsApi.create).mockRejectedValueOnce(
      new MeetingError("NETWORK_ERROR"),
    );
    await fillPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Meeting" }));
    });
    expect(mock.replace).not.toHaveBeenCalled();
    const original = vi.mocked(meetingsApi.create).mock.calls[0][0];
    expect(original).toMatchObject({
      attendeeMemberIds: [member.id],
      description: "  General details  ",
      preparationNotes: "  Bring portfolio  ",
    });
    act(() => emit({ ...identity(), status: "checking", session: null }));
    act(() =>
      emit({
        ...identity(),
        status: "error",
        session: null,
        error: new AuthError("DEPENDENCY_UNAVAILABLE", 503),
      }),
    );
    expect(screen.queryByDisplayValue("Draft title")).not.toBeInTheDocument();
    expect(screen.queryByText(member.email)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save Meeting" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check account again" }),
    );
    expect(mock.refresh).toHaveBeenCalledTimes(2);
    act(() => emit(identity()));
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Draft title");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "  General details  ",
    );
    expect(screen.getByLabelText("Preparation Notes")).toHaveValue(
      "  Bring portfolio  ",
    );
    expect(
      screen.getByRole("button", { name: "Remove Member One" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Meeting" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Check save result again" }),
      );
    });
    expect(vi.mocked(meetingsApi.create).mock.calls[1][0]).toBe(original);
    expect(mock.replace).toHaveBeenCalledWith("/meetings/meeting");
    expect(mock.replace).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("region", { name: "Saved meeting" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    identity("other"),
    { ...identity(), status: "anonymous", session: null },
    {
      ...identity(),
      status: "error",
      session: null,
      error: new AuthError("CANDIDATE_DENIED", 403),
    },
  ] as AuthSnapshot[])(
    "discards full draft/team on confirmed account change or loss of access %s",
    async (next) => {
      const { result } = renderHook(() => useMeetingCreateForm());
      act(() => {
        result.current.change("title", "Private draft");
        result.current.change("preparationNotes", "Private preparation");
      });
      await act(async () => result.current.picker.setQuery("Member"));
      await waitFor(() => expect(result.current.picker.items).toEqual([member]));
      act(() => result.current.picker.select(member.id));
      expect(result.current.picker.selected).toEqual([member]);
      act(() => emit(next));
      act(() => emit(identity()));
      expect(result.current.values.title).toBe("");
      expect(result.current.values.preparationNotes).toBe("");
      expect(result.current.picker.selected).toEqual([]);
    },
  );
  it("explains terminal 410 with navigation and no Save or retry control", async () => {
    vi.mocked(meetingsApi.create).mockRejectedValue(
      new MeetingError("MEETING_DELETED", 410),
    );
    await fillPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save Meeting" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The meeting for this request was deleted",
    );
    expect(
      screen.getByRole("link", { name: "Back to meetings" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(
      screen.queryByRole("button", { name: "Save Meeting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Check save result again" }),
    ).not.toBeInTheDocument();
    expect(meetingsApi.create).toHaveBeenCalledOnce();
    expect(meetingsApi.read).not.toHaveBeenCalled();
  });
});

describe("latest human Add date rules", () => {
  it("starts blank and clears only an earlier End on committed Start changes", () => {
    const { result } = renderHook(() => useMeetingCreateForm());
    expect(result.current.values.startDate).toBe("");
    expect(result.current.values.endDate).toBe("");
    act(() => {
      result.current.change("title", "Keep title");
      result.current.change("endDate", "2030-01-02");
    });
    const previous = result.current.values;
    act(() => result.current.change("startDate", "2030-01-03"));
    expect(result.current.values).toEqual({
      ...previous,
      startDate: "2030-01-03",
      endDate: "",
    });
    expect(result.current.errors).toEqual({});
  });
  it("keeps an End equal to or later than the selected Start", () => {
    const { result } = renderHook(() => useMeetingCreateForm());
    act(() => {
      result.current.change("endDate", "2030-01-02");
      result.current.change("startDate", "2030-01-02");
    });
    expect(result.current.values.endDate).toBe("2030-01-02");
    act(() => result.current.change("startDate", "2030-01-01"));
    expect(result.current.values.endDate).toBe("2030-01-02");
  });
  it("does not toast on Start change; invalid Save shows one dismissible error toast and focuses first invalid field without POST", async () => {
    await act(async () => {
      render(<MeetingCreateForm />);
    });
    expect(screen.getByLabelText(/^Start date/)).toHaveValue("");
    expect(screen.getByLabelText(/^End date/)).toHaveValue("");
    chooseDate("End date", 1);
    chooseDate("Start date", 2);
    expect(screen.getByLabelText(/^End date/)).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Meeting and team created"),
    ).not.toBeInTheDocument();
    expect(meetingsApi.create).not.toHaveBeenCalled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Save Meeting" }).closest("form")!,
    );
    const toast = screen
      .getByText(/^Check \d+ fields before saving\.$/)
      .closest('[role="alert"]');
    expect(toast).toHaveTextContent(/^Check \d+ fields before saving\.$/);
    expect(
      screen.getAllByText(/^Check \d+ fields before saving\.$/),
    ).toHaveLength(1);
    expect(screen.getByLabelText(/^Candidate Name/)).toHaveFocus();
    expect(
      screen.queryByText(
        "Your entries are preserved. Correct the fields marked below.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(
      screen.queryByText(/^Check \d+ fields before saving\.$/),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Candidate Name/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getAllByText("This field is required.").length,
    ).toBeGreaterThan(0);
    expect(meetingsApi.create).not.toHaveBeenCalled();
    expect(mock.replace).not.toHaveBeenCalled();
  });
});

// Human-confirmed strict future End and manual HTTPS rules, checked only on Save.
describe("Add Save time/link boundaries at frozen Bangkok 2030-01-01 09:30", () => {
  async function draft() {
    const hook = renderHook(() => useMeetingCreateForm());
    await act(async () => {});
    act(() => {
      hook.result.current.change("candidateName", "Candidate");
      hook.result.current.change("candidateEmail", "candidate@example.test");
      hook.result.current.change("position", "Engineer");
      hook.result.current.change("title", "Boundary interview");
      hook.result.current.change("startDate", "2030-01-01");
      hook.result.current.change("endDate", "2030-01-01");
      hook.result.current.change("start", "09:00");
      hook.result.current.change("end", "09:31");
      hook.result.current.change(
        "joinUrl",
        " https://any-host.example.test/room?key=value ",
      );
    });
    await act(async () => hook.result.current.picker.setQuery("Member"));
    await waitFor(() => expect(hook.result.current.picker.items).toEqual([member]));
    act(() => hook.result.current.picker.select(member.id));
    expect(hook.result.current.picker.selected).toHaveLength(1);
    return hook;
  }
  for (const format of ["ONSITE", "ONLINE"] as const) {
    it.each([
      ["same-day past", "2030-01-01", "09:00", "2030-01-01", "09:29", false],
      [
        "same-day equal now",
        "2030-01-01",
        "09:00",
        "2030-01-01",
        "09:30",
        false,
      ],
      ["same-day future", "2030-01-01", "09:00", "2030-01-01", "09:31", true],
      [
        "tomorrow earlier clock",
        "2030-01-02",
        "07:00",
        "2030-01-02",
        "08:00",
        true,
      ],
      [
        "future End equals Start",
        "2030-01-02",
        "12:00",
        "2030-01-02",
        "12:00",
        false,
      ],
      [
        "future End before Start",
        "2030-01-02",
        "12:00",
        "2030-01-02",
        "11:59",
        false,
      ],
    ] as const)(
      `${format}: %s validates only at explicit Save`,
      async (_label, startDate, start, endDate, end, allowed) => {
        const { result } = await draft();
        act(() => {
          result.current.changeFormat(format);
          result.current.change("startDate", startDate);
          result.current.change("start", start);
          result.current.change("endDate", endDate);
          result.current.change("end", end);
        });
        expect(result.current.errors).toEqual({});
        expect(meetingsApi.create).not.toHaveBeenCalled();
        await act(async () => result.current.submit());
        if (allowed) {
          expect(result.current.errors).toEqual({});
          expect(meetingsApi.create).toHaveBeenCalledOnce();
          expect(vi.mocked(meetingsApi.create).mock.calls[0][0]).toMatchObject({
            startsAt: `${startDate}T${start}:00+07:00`,
            endsAt: `${endDate}T${end}:00+07:00`,
            format,
            ...(format === "ONLINE"
              ? { joinUrl: "https://any-host.example.test/room?key=value" }
              : {}),
          });
        } else {
          expect(result.current.errors.end).toBeTruthy();
          expect(meetingsApi.create).not.toHaveBeenCalled();
        }
      },
    );
  }
  it("reads current time at Save instead of accepting a draft that has become past", async () => {
    const { result } = await draft();
    expect(result.current.errors).toEqual({});
    vi.setSystemTime(new Date("2030-01-01T02:31:00Z"));
    await act(async () => result.current.submit());
    expect(result.current.errors.end).toBe(
      "The end time must be in the future.",
    );
    expect(meetingsApi.create).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "   ",
    "not a link",
    "https://",
    "http://example.test/room",
    "/room",
    "https://user:password@example.test/room",
  ])("rejects invalid manual link at Save without POST: %s", async (link) => {
    const { result } = await draft();
    act(() => {
      result.current.changeFormat("ONLINE");
      result.current.change("joinUrl", link);
    });
    expect(result.current.errors).toEqual({});
    expect(meetingsApi.create).not.toHaveBeenCalled();
    await act(async () => result.current.submit());
    expect(result.current.errors.joinUrl).toBe(
      "Enter a valid HTTPS meeting link.",
    );
    expect(meetingsApi.create).not.toHaveBeenCalled();
  });
});
