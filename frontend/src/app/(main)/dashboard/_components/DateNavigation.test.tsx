import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateNavigation } from "./DateNavigation";
import { monday, shiftDay, validDate } from "./dates";
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});
function Harness({ change }: { change: (date: string) => void }) {
  const [date, setDate] = useState("2026-10-08"),
    [week, setWeek] = useState("2026-10-05");
  return (
    <DateNavigation
      value={date}
      week={week}
      onWeekChange={setWeek}
      onChange={(date) => {
        change(date);
        setDate(date);
        setWeek(monday(date));
      }}
    />
  );
}
describe("Dashboard single-date calendar", () => {
  it("keeps draft local until Apply and Cancel keeps selected date", async () => {
    const events = userEvent.setup(),
      change = vi.fn();
    render(<Harness change={change} />);
    await events.click(screen.getByRole("button", { name: "Choose date" }));
    let dialog = screen.getByRole("dialog");
    await events.click(
      within(dialog).getByRole("button", { name: "Friday, 9 October 2026" }),
    );
    expect(change).not.toHaveBeenCalled();
    await events.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(change).not.toHaveBeenCalled();
    await events.click(screen.getByRole("button", { name: "Choose date" }));
    dialog = screen.getByRole("dialog");
    await events.click(
      within(dialog).getByRole("button", { name: "Friday, 9 October 2026" }),
    );
    await events.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(change).toHaveBeenCalledWith("2026-10-09");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("allows a past date and keyboard calendar navigation", async () => {
    const events = userEvent.setup(),
      change = vi.fn();
    render(<Harness change={change} />);
    await events.click(screen.getByRole("button", { name: "Choose date" }));
    const dialog = screen.getByRole("dialog"),
      day = within(dialog).getByRole("button", {
        name: "Thursday, 8 October 2026",
      });
    day.focus();
    await events.keyboard("{ArrowLeft}");
    expect(
      within(dialog).getByRole("button", { name: "Wednesday, 7 October 2026" }),
    ).toHaveFocus();
    await events.keyboard("{Enter}");
    await events.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(change).toHaveBeenCalledWith("2026-10-07");
  });
  it("checks actual calendar dates and Monday/year boundaries", () => {
    expect(validDate("2026-02-30")).toBe(false);
    expect(validDate("2028-02-29")).toBe(true);
    expect(validDate("not-a-date")).toBe(false);
    expect(monday("2027-01-01")).toBe("2026-12-28");
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
});
