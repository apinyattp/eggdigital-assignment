import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { useMeetingFeedback } from "@/hooks/useMeetingFeedback";
import { MeetingFeedback } from "./MeetingFeedback";
const own = {
  id: "own",
  text: "Own text",
  author: { displayName: "Same name" },
  isOwn: true,
  createdAt: "2020-01-01T00:00:00.000001Z",
  updatedAt: "2026-10-08T05:00:00.000123Z",
};
function model(): ReturnType<typeof useMeetingFeedback> {
  return {
    meetingId: "meeting",
    principal: "member:owner",
    phase: "ready",
    items: [own],
    ownFeedbackId: "own",
    page: 1,
    total: 1,
    asOf: "2026-10-08T06:00:00Z",
    snapshot: "snapshot",
    loading: null,
    failedPage: 1,
    error: null,
    refreshRequired: false,
    editor: null,
    saved: false,
    revision: "latest",
    visible: true,
    canAdd: false,
    refresh: vi.fn(),
    older: vi.fn(),
    retryLoad: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    change: vi.fn(),
    save: vi.fn(),
    retrySave: vi.fn(),
    resolve: vi.fn(),
  };
}
describe("meeting Feedback page-local UI", () => {
  it("shows one latest timestamp per row and edits only server-marked own rows, not matching names", () => {
    const feedback = model();
    feedback.items = [
      own,
      { ...own, id: "other", isOwn: false, text: "Other text" },
    ];
    const { container } = render(
      <MeetingFeedback feedback={feedback} authorName="Same name" />,
    );
    expect(container.querySelectorAll("time")).toHaveLength(2);
    for (const time of container.querySelectorAll("time")) {
      expect(time).toHaveAttribute("datetime", own.updatedAt);
      expect(time.textContent).not.toContain("2020");
    }
    expect(
      screen.getAllByRole("button", { name: "Edit Feedback" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit Feedback" }));
    expect(feedback.open).toHaveBeenCalledWith("own");
    expect(screen.getByRole("button", { name: "Add Feedback" })).toBeDisabled();
  });
  it("keeps Add disabled for own row outside latest50 and exposes older-load action", () => {
    const feedback = model();
    feedback.items = [];
    feedback.total = 51;
    render(<MeetingFeedback feedback={feedback} authorName="Owner" />);
    expect(screen.getByRole("button", { name: "Add Feedback" })).toBeDisabled();
    expect(
      screen.getByText(/Load older feedback to edit your entry./),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Load older feedback" }),
    );
    expect(feedback.older).toHaveBeenCalledOnce();
  });
  it("keeps ordinary Feedback free of an extra Refresh control", () => {
    render(<MeetingFeedback feedback={model()} authorName="Owner" />);
    expect(
      screen.queryByRole("button", { name: "Refresh Feedback" }),
    ).not.toBeInTheDocument();
  });
  it("describes a failed initial read without claiming it is still loading", () => {
    const feedback = model();
    feedback.phase = "error";
    feedback.error = "REQUEST_FAILED";
    feedback.items = [];
    feedback.ownFeedbackId = null;
    render(<MeetingFeedback feedback={feedback} authorName="Owner" />);
    expect(
      screen.queryByText("Feedback is loading or saving."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry loading feedback" }),
    ).toBeEnabled();
  });
  it("offers explicit refresh for expired cursor without automatically invoking it", () => {
    const feedback = model();
    feedback.error = "INVALID_CURSOR";
    feedback.refreshRequired = true;
    feedback.total = 51;
    render(<MeetingFeedback feedback={feedback} authorName="Owner" />);
    expect(feedback.refresh).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Load older feedback" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Feedback" }));
    expect(feedback.refresh).toHaveBeenCalledOnce();
  });
});
