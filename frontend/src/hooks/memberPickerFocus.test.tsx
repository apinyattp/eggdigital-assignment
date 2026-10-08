import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/api/meetings";
import type { MemberPage } from "@/api/members";
import type { AuthSnapshot } from "./authController";

const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  listeners: new Set<() => void>(),
  search: vi.fn(),
  read: vi.fn(),
}));
vi.mock("./authController", () => ({
  authController: {
    getSnapshot: () => mock.snapshot,
    subscribe: (listener: () => void) => {
      mock.listeners.add(listener);
      return () => mock.listeners.delete(listener);
    },
    refresh: vi.fn(),
  },
  initialAuthSnapshot: {},
}));
vi.mock("@/api/members", async (original) => ({
  ...(await original<typeof import("@/api/members")>()),
  membersApi: { search: mock.search },
}));
vi.mock("@/api/meetings", async (original) => ({
  ...(await original<typeof import("@/api/meetings")>()),
  meetingsApi: { read: mock.read, edit: vi.fn() },
}));

import { TeamPicker } from "@/app/(main)/meetings/new/_components/TeamPicker";
import { EditTeamPicker } from "@/app/(main)/meetings/[meetingId]/edit/_components/EditTeamPicker";
import { useMemberPicker } from "./useMemberPicker";
import { useMeetingEdit } from "./useMeetingEdit";

const members = Array.from({ length: 40 }, (_, index) => ({
  id: `member-${index + 1}`,
  displayName: `Member ${index + 1}`,
  email: `member-${index + 1}@example.test`,
}));
const meeting: Meeting = {
  id: "meeting",
  creatorId: "owner",
  candidate: { name: "Candidate", email: "candidate@example.test" },
  title: "Interview",
  position: "Engineer",
  description: null,
  preparationNotes: null,
  startsAt: "2099-10-08T03:00:00Z",
  endsAt: "2099-10-08T04:00:00Z",
  status: "PENDING",
  format: "ONSITE",
  location: "Room",
  attendees: [
    {
      memberId: null,
      displayName: "Existing Guest",
      email: "guest@example.test",
    },
  ],
  createdAt: "2026-10-08T00:00:00Z",
  updatedAt: "2026-10-08T00:00:00Z",
};
const memberPage = (page: number): MemberPage => ({
  items: members.slice((page - 1) * 20, page * 20),
  page,
  pageSize: 20,
  total: 40,
  totalPages: 2,
});
function deferred() {
  let resolve!: (value: MemberPage) => void;
  const promise = new Promise<MemberPage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function CreatePicker() {
  return <TeamPicker picker={useMemberPicker()} />;
}
function EditPicker() {
  return <EditTeamPicker edit={useMeetingEdit("meeting")} />;
}

beforeEach(() => {
  mock.listeners.clear();
  mock.search.mockReset();
  mock.read.mockReset().mockResolvedValue(meeting);
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
    error: null,
    pending: null,
    logoutRequired: false,
  };
});

describe.each([
  ["create", CreatePicker],
  ["edit", EditPicker],
] as const)("%s member picker focus", (kind, Picker) => {
  async function setup() {
    const pending = deferred();
    const focusAtRequest: Element[] = [];
    mock.search.mockImplementation((_query: string, page: number) => {
      if (page === 1) return Promise.resolve(memberPage(1));
      focusAtRequest.push(document.activeElement!);
      return pending.promise;
    });
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Before picker</button>
        <Picker />
        <button type="button">After picker</button>
      </>,
    );
    const input = screen.getByRole("combobox");
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "member");
    await waitFor(
      () => expect(screen.getAllByRole("option")).toHaveLength(20),
      { timeout: 3000 },
    );
    const more = screen.getByRole("button", { name: "Load more members" });
    return { user, input, more, pending, focusAtRequest };
  }

  it.each(["{Enter}", " "])(
    "reaches Load more with Tab and returns focus before loading via %s",
    async (key) => {
      const { user, input, more, pending, focusAtRequest } = await setup();
      await user.tab();
      expect(more).toHaveFocus();
      expect(input).toHaveAttribute("aria-expanded", "true");
      await user.keyboard(key);
      expect(focusAtRequest).toEqual([input]);
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-busy", "true");
      expect(input).toHaveAttribute("aria-expanded", "true");
      expect(more).toBeDisabled();
      expect(screen.getAllByRole("option")).toHaveLength(20);
      await act(async () => pending.resolve(memberPage(2)));
      expect(input).toHaveFocus();
      expect(input).toHaveAttribute("aria-busy", "false");
      expect(screen.getAllByRole("option")).toHaveLength(40);
      expect(
        screen.queryByRole("button", { name: "Load more members" }),
      ).toBeNull();
      expect(mock.search).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps primary pointer focus in the input and ignores repeated activation while disabled", async () => {
    const { user, input, more, pending, focusAtRequest } = await setup();
    await user.pointer({ target: more, keys: "[MouseLeft>]" });
    expect(input).toHaveFocus();
    await user.pointer({ target: more, keys: "[/MouseLeft]" });
    expect(focusAtRequest).toEqual([input]);
    expect(input).toHaveFocus();
    expect(more).toBeDisabled();
    await user.click(more);
    await user.click(more);
    expect(mock.search).toHaveBeenCalledTimes(2);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");
    await act(async () => pending.resolve(memberPage(2)));
    expect(screen.getAllByRole("option")).toHaveLength(40);
  });

  it.each(["pointer", "Tab"])(
    "keeps results dismissed after %s leaves the picker during loading",
    async (method) => {
      const { user, input, more, pending } = await setup();
      await user.click(more);
      if (method === "Tab") await user.tab({ shift: true });
      else
        await user.click(screen.getByRole("button", { name: "Before picker" }));
      expect(
        screen.getByRole("button", { name: "Before picker" }),
      ).toHaveFocus();
      expect(input).toHaveAttribute("aria-expanded", "false");
      await act(async () => pending.resolve(memberPage(2)));
      expect(input).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryAllByRole("option")).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: "Before picker" }),
      ).toHaveFocus();
    },
  );

  it("preserves Escape dismissal and arrow/Enter selection after loading", async () => {
    const { user, input, more, pending } = await setup();
    await user.click(more);
    await act(async () => pending.resolve(memberPage(2)));
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByRole("button", {
        name: kind === "create" ? "Remove Member 1" : "Remove added Member 1",
      }),
    ).toBeVisible();
    if (kind === "edit") {
      expect(
        screen.getByRole("button", { name: "Remove Existing Guest" }),
      ).toBeVisible();
    }
  });
});
