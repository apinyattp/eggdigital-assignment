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
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(
      0,
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: /10 October 2026$/ }),
    );
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
    fireEvent.click(
      screen.getByRole("button", { name: /10 October 2026$/ }),
    );
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
    const firstDay = screen.getByRole("button", {
      name: /\b8 October 2026$/,
    });
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
    fireEvent.click(
      screen.getByRole("button", { name: /10 October 2026/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-10");
  });

  it("uses a later minimum after Start changes without silently changing End", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      picker("2026-10-10", "2026-10-08", onChange),
    );
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
    expect(screen.getByRole("button", { name: /^2026$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("Date picker repeated rendering", () => {
  const dates = () =>
    Array.from(
      screen
        .getByRole("group", { name: "Choose one date" })
        .querySelectorAll<HTMLButtonElement>("button[data-date]"),
    );

  it("reuses grid labels through parent rerenders and same-month focus navigation", () => {
    const onChange = vi.fn();
    const formatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    const { rerender } = render(
      picker("2026-10-10", "2026-10-08", onChange),
    );
    fireEvent.click(screen.getByLabelText("End date"));
    const labels = dates().map((button) =>
      button.getAttribute("aria-label"),
    );
    formatting.mockClear();

    for (let count = 0; count < 3; count++) {
      rerender(picker("2026-10-10", "2026-10-08", onChange));
      fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    }

    expect(formatting).not.toHaveBeenCalled();
    expect(
      dates().map((button) => button.getAttribute("aria-label")),
    ).toEqual(labels);
    expect(
      screen.getByRole("button", { name: "Tuesday, 13 October 2026" }),
    ).toHaveFocus();
    expect(
      screen.getByText("Selected: Saturday, 10 October 2026"),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("formats only the changed draft when selecting repeatedly in the same month", () => {
    const onChange = vi.fn();
    const formatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    render(picker("2026-10-10", "2026-10-08", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    formatting.mockClear();

    for (const day of [11, 12, 13]) {
      fireEvent.click(
        dates().find((button) => button.dataset.date === `2026-10-${day}`)!,
      );
    }

    expect(formatting).toHaveBeenCalledTimes(3);
    expect(
      screen.getByText("Selected: Tuesday, 13 October 2026"),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2026-10-13");
  });

  it("refreshes grid labels when arrow focus crosses into the next year", () => {
    const onChange = vi.fn();
    const formatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    render(picker("2026-12-31", "2026-12-01", onChange));
    fireEvent.click(screen.getByLabelText("End date"));
    formatting.mockClear();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });

    expect(formatting).toHaveBeenCalledTimes(42);
    expect(
      screen.getByRole("button", { name: "Select month" }),
    ).toHaveTextContent("Jan");
    expect(
      screen.getByRole("button", { name: "Friday, 1 January 2027" }),
    ).toHaveFocus();
    expect(dates()[0]).toHaveAccessibleName("Monday, 28 December 2026");
    expect(dates()[41]).toHaveAccessibleName("Sunday, 7 February 2027");
    expect(
      screen.getByText("Selected: Thursday, 31 December 2026"),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    [
      "2026-10-10",
      "2026-10-08",
      "Oct",
      "Monday, 28 September 2026",
      "Sunday, 8 November 2026",
      "Saturday, 10 October 2026",
    ],
    [
      "2026-12-31",
      "2026-12-01",
      "Dec",
      "Monday, 30 November 2026",
      "Sunday, 10 January 2027",
      "Thursday, 31 December 2026",
    ],
    [
      "2028-02-29",
      "2028-02-28",
      "Feb",
      "Monday, 31 January 2028",
      "Sunday, 12 March 2028",
      "Tuesday, 29 February 2028",
    ],
  ])(
    "keeps exact UTC labels at month/year/leap boundaries for %s",
    (value, min, month, first, last, selected) => {
      render(picker(value, min, vi.fn()));
      fireEvent.click(screen.getByLabelText("End date"));
      expect(dates()).toHaveLength(42);
      expect(dates()[0]).toHaveAccessibleName(first);
      expect(dates()[41]).toHaveAccessibleName(last);
      expect(
        screen.getByRole("button", { name: "Select month" }),
      ).toHaveTextContent(month);
      expect(
        screen.getByRole("button", { name: selected }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(`Selected: ${selected}`)).toBeVisible();
    },
  );

  it("refreshes month/year grids and minimum guards without changing the draft implicitly", () => {
    const onChange = vi.fn();
    const formatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    const { rerender } = render(
      picker("2026-10-10", "2026-10-08", onChange),
    );
    fireEvent.click(screen.getByLabelText("End date"));
    formatting.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Select year" }));
    fireEvent.click(screen.getByRole("button", { name: "Next years" }));
    fireEvent.click(
      screen.getByRole("button", { name: "2028" }),
    );
    expect(formatting).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Feb" }),
    );
    expect(formatting).toHaveBeenCalledTimes(42);
    expect(
      screen.getByRole("button", { name: "Tuesday, 29 February 2028" }),
    ).toBeEnabled();
    expect(
      screen.getByText("Selected: Saturday, 10 October 2026"),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();

    formatting.mockClear();
    rerender(picker("2026-10-10", "2028-03-01", onChange));
    expect(formatting).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Tuesday, 29 February 2028" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Wednesday, 1 March 2028" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Wednesday, 1 March 2028" }),
    );
    expect(formatting).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("2028-03-01");
  });
});
