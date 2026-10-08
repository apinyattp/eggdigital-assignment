import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
const mock = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace }),
}));
import {
  MeetingDeleteAction,
  MeetingLifecycleActions,
} from "./MeetingLifecycleActions";
type Lifecycle = ReturnType<typeof useMeetingLifecycle>;
function controller(patch: Partial<Lifecycle> = {}): Lifecycle {
  return {
    meetingId: "meeting",
    owner: "owner",
    action: null,
    phase: "idle",
    meeting: null,
    latest: null,
    writePending: false,
    error: null,
    visible: true,
    prepare: vi.fn(),
    close: vi.fn(),
    confirm: vi.fn(),
    retry: vi.fn(),
    reviewLatest: vi.fn(),
    useLatest: vi.fn(),
    ...patch,
  };
}
const base = {
  meetingId: "meeting",
  creatorId: "owner",
  status: "CONFIRMED" as const,
  returnDate: "2026-10-08",
};
beforeEach(() => {
  mock.replace.mockClear();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
describe("creator lifecycle controls and explicit confirmation", () => {
  it("keeps Join in the action row for a member who is not the creator", () => {
    render(
      <MeetingLifecycleActions
        {...base}
        joinUrl="https://meeting.example.test/room"
        lifecycle={controller({ owner: "other" })}
        onMeetingChanged={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    const join = screen.getByRole("link", { name: "Join Meeting" });
    expect(join).toHaveAttribute("href", "https://meeting.example.test/room");
    expect(join).toHaveAttribute("target", "_blank");
    expect(join).toHaveAttribute("rel", "noopener noreferrer");
    expect(join.closest("section")).toHaveAttribute(
      "aria-label",
      "Meeting actions",
    );
    expect(
      screen.queryByRole("link", { name: "Edit Meeting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel Meeting" }),
    ).not.toBeInTheDocument();
  });
  it("keeps Edit date context and prepares rather than submits a destructive action", async () => {
    const lifecycle = controller();
    render(
      <>
        <MeetingLifecycleActions
          {...base}
          lifecycle={lifecycle}
          onMeetingChanged={vi.fn()}
          onUnavailable={vi.fn()}
        />
        <MeetingDeleteAction lifecycle={lifecycle} creatorId="owner" />
      </>,
    );
    expect(screen.getByRole("link", { name: "Edit Meeting" })).toHaveAttribute(
      "href",
      "/meetings/meeting/edit?date=2026-10-08",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^Delete Meeting$/ }));
    expect(lifecycle.prepare).toHaveBeenCalledWith("delete", "owner");
    expect(lifecycle.confirm).not.toHaveBeenCalled();
  });
  it("Keep Meeting closes the dialog without confirming", async () => {
    const lifecycle = controller({ action: "delete", phase: "confirm" });
    render(
      <MeetingLifecycleActions
        {...base}
        lifecycle={lifecycle}
        onMeetingChanged={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^Keep Meeting$/ }));
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(lifecycle.confirm).not.toHaveBeenCalled();
  });
  it("does not expose creator controls to another member", () => {
    render(
      <MeetingLifecycleActions
        {...base}
        lifecycle={controller({ owner: "other" })}
        onMeetingChanged={vi.fn()}
        onUnavailable={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("link", { name: "Edit Meeting" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete Meeting" }),
    ).not.toBeInTheDocument();
  });
  it("redirects after confirmed delete and consumes completion before a parent refresh can remount", async () => {
    const lifecycle = controller({ action: "delete", phase: "complete" }),
      changed = vi.fn();
    render(
      <MeetingLifecycleActions
        {...base}
        lifecycle={lifecycle}
        onMeetingChanged={changed}
        onUnavailable={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(mock.replace).toHaveBeenCalledWith("/dashboard?date=2026-10-08"),
    );
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  });
  it("refreshes core meeting only after cancellation readback, without claiming provider/Feedback changes", async () => {
    const lifecycle = controller({ action: "cancel", phase: "complete" }),
      changed = vi.fn();
    render(
      <MeetingLifecycleActions
        {...base}
        lifecycle={lifecycle}
        onMeetingChanged={changed}
        onUnavailable={vi.fn()}
      />,
    );
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(mock.replace).not.toHaveBeenCalled();
  });
});
