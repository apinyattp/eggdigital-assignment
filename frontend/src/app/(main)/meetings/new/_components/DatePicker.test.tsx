import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatePicker } from "./DatePicker";

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
});
afterEach(() => vi.restoreAllMocks());

const picker = (
  value: string,
  min: string,
  onChange: (date: string) => void,
) => (
  <>
    <label htmlFor="endDate">End date</label>
    <DatePicker
      id="endDate"
      value={value}
      min={min}
      disabled={false}
      invalid={false}
      onChange={onChange}
    />
  </>
);

describe("Add date picker minimum and views", () => {
  it("opens a blank date without selecting or committing the displayed day", () => {
    const onChange = vi.fn();
    render(picker("", "2026-10-08", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    expect(screen.getByText("No date selected")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select month" }),
    ).toHaveTextContent("Oct");
    expect(
      screen.getByRole("button", { name: /\b8 October 2026$/ }),
    ).toHaveFocus();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("End date")).toHaveValue("");
  });

  it("commits a valid date from an empty field only after explicit Apply", () => {
    const onChange = vi.fn();
    render(picker("", "2026-10-10", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    expect(
      screen.getByRole("button", { name: /\b8 October 2026$/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /10 October 2026$/ }));
    expect(
      screen.getByText("Selected: Saturday, 10 October 2026"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-10-10");
  });

  it("cancels a tentative selection and reopens the original blank value", () => {
    const onChange = vi.fn();
    render(picker("", "2026-10-08", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    fireEvent.click(screen.getByRole("button", { name: /10 October 2026$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("End date")).toHaveValue("");
    fireEvent.click(screen.getByLabelText("End date"));
    expect(screen.getByText("No date selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("keeps keyboard focus navigation separate from an empty selection", () => {
    const onChange = vi.fn();
    render(picker("", "2026-10-08", onChange));
    fireEvent.keyDown(screen.getByLabelText("End date"), { key: "Enter" });
    const firstDay = screen.getByRole("button", { name: /\b8 October 2026$/ });
    fireEvent.keyDown(firstDay, { key: "ArrowLeft" });
    expect(firstDay).toHaveFocus();
    fireEvent.keyDown(firstDay, { key: "ArrowRight" });
    expect(
      screen.getByRole("button", { name: /\b9 October 2026$/ }),
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("blocks dates before the selected start but permits the same calendar day", () => {
    const onChange = vi.fn();
    render(picker("2026-10-08", "2026-10-10", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    expect(
      screen.getByRole("button", { name: /\b8 October 2026$/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /10 October 2026/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /10 October 2026/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-10");
  });

  it("uses a later minimum after Start changes without silently changing End", () => {
    const onChange = vi.fn();
    const { rerender } = render(picker("2026-10-10", "2026-10-08", onChange));
    rerender(picker("2026-10-10", "2026-10-12", onChange));
    expect(screen.getByLabelText("End date")).toHaveValue("2026-10-10");
    fireEvent.click(screen.getByLabelText("End date"));
    expect(
      screen.getByRole("button", { name: /10 October 2026/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /12 October 2026/ }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks the displayed month and year in their selection views", () => {
    render(picker("2026-10-10", "2026-10-08", vi.fn()));
    fireEvent.click(screen.getByLabelText("End date"));
    fireEvent.click(screen.getByRole("button", { name: "Select month" }));
    expect(screen.getByRole("button", { name: "Oct" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Select year" }));
    expect(
      screen.getByRole("button", { name: /^2026$/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
