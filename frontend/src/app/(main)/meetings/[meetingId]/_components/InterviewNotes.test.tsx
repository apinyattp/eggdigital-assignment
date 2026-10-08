import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { useInterviewNotes } from "@/hooks/useInterviewNotes";
import { InterviewNotes } from "./InterviewNotes";
function model(): ReturnType<typeof useInterviewNotes> {
  return {
    meetingId: "meeting",
    principal: "member:owner",
    phase: "ready",
    note: null,
    draft: "",
    error: null,
    latest: null,
    latestLoaded: false,
    saved: false,
    visible: true,
    locked: false,
    change: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    loadLatest: vi.fn(),
    resolve: vi.fn(),
  };
}
describe("private Notes page-local UI", () => {
  it("exposes one private editor with no author selector and allows empty note save", () => {
    const notes = model();
    render(<InterviewNotes notes={notes} authorName="Owner" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("เฉพาะคุณ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(notes.save).toHaveBeenCalledOnce();
  });
  it("locks the unknown draft and retries its existing operation", () => {
    const notes = {
      ...model(),
      phase: "unknown" as const,
      locked: true,
      draft: "Retained note",
    };
    render(<InterviewNotes notes={notes} authorName="Owner" />);
    expect(screen.getByRole("textbox")).toHaveValue("Retained note");
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    fireEvent.click(
      screen.getByRole("button", { name: "Check original request again" }),
    );
    expect(notes.retry).toHaveBeenCalledOnce();
    expect(notes.save).not.toHaveBeenCalled();
  });
  it("keeps conflict draft visible while requiring a deliberate latest-value choice", () => {
    const notes = {
      ...model(),
      phase: "conflict" as const,
      locked: true,
      draft: "My draft",
      latest: { text: "Latest note", updatedAt: "2026-10-08T05:00:00.000123Z" },
      latestLoaded: true,
    };
    render(<InterviewNotes notes={notes} authorName="Owner" />);
    expect(screen.getByRole("textbox")).toHaveValue("My draft");
    expect(screen.getByText("Latest note")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep my text to save again" }),
    );
    expect(notes.resolve).toHaveBeenCalledWith(true);
    expect(notes.save).not.toHaveBeenCalled();
  });
});
