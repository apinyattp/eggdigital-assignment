"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "../date-time-picker.module.css";
const iso = (date: Date) => date.toISOString().slice(0, 10);
const label = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
const shifted = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return iso(value);
};
export function DatePicker({
  id,
  value,
  min,
  disabled,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  min: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={trigger}
        id={id}
        className={styles.dateTrigger}
        readOnly
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-required="true"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && !disabled && (
        <Calendar
          value={value}
          min={min}
          onChange={onChange}
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
        />
      )}
    </>
  );
}
function Calendar({
  value,
  min,
  onChange,
  onClose,
}: {
  value: string;
  min: string;
  onChange: (date: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value),
    [display, setDisplay] = useState((value < min ? min : value).slice(0, 7) + "-01"),
    [focus, setFocus] = useState(value < min ? min : value);
  const [view, setView] = useState<"day" | "month" | "year">("day");
  const year = Number(display.slice(0, 4)),
    month = Number(display.slice(5, 7)) - 1,
    yearStart = Math.floor(year / 12) * 12;
  const first = new Date(`${display}T12:00:00Z`),
    monday = shifted(display, -((first.getUTCDay() + 6) % 7));
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, i, 1)).toLocaleDateString("en-GB", {
      month: "short",
      timeZone: "UTC",
    }),
  );
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)
      ?.focus();
  }, [focus, display, view]);
  function move(step: number) {
    const next = iso(
      new Date(
        Date.UTC(
          year + (view === "year" ? step * 12 : view === "month" ? step : 0),
          month + (view === "day" ? step : 0),
          1,
        ),
      ),
    );
    setDisplay(next);
    setFocus(next < min ? min : next);
  }
  function key(event: KeyboardEvent, date: string) {
    const shifts: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next =
      shifts[event.key] !== undefined ? shifted(date, shifts[event.key]) : null;
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (event.key === "Home") next = shifted(date, -weekday);
    if (event.key === "End") next = shifted(date, 6 - weekday);
    if (event.key === "PageUp" || event.key === "PageDown")
      next = iso(
        new Date(
          Date.UTC(
            Number(date.slice(0, 4)),
            Number(date.slice(5, 7)) - 1 + (event.key === "PageUp" ? -1 : 1),
            Number(date.slice(-2)),
          ),
        ),
      );
    if (next) {
      event.preventDefault();
      next = next < min ? min : next;
      setFocus(next);
      setDisplay(next.slice(0, 7) + "-01");
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.calendar}
      aria-labelledby="date-picker-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <h2 id="date-picker-title">Choose date</h2>
      <div className={styles.navigation}>
        <button
          type="button"
          aria-label={`Previous ${view === "day" ? "month" : "years"}`}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <div>
          {view === "day" ? (
            <>
              <button
                type="button"
                className={styles.heading}
                aria-label="Select month"
                onClick={() => setView("month")}
              >
                {months[month]}
              </button>
              <button
                type="button"
                className={styles.heading}
                aria-label="Select year"
                onClick={() => setView("year")}
              >
                {year}
              </button>
            </>
          ) : view === "month" ? (
            <button
              type="button"
              className={styles.heading}
              aria-label="Select year"
              onClick={() => setView("year")}
            >
              {year} · Select month
            </button>
          ) : (
            <strong>{yearStart}–{yearStart + 11}</strong>
          )}
        </div>
        <button
          type="button"
          aria-label={`Next ${view === "day" ? "month" : "years"}`}
          onClick={() => move(1)}
        >
          ›
        </button>
      </div>
      {view === "day" ? (
        <>
          <div className={styles.weekdays} aria-hidden="true">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            className={styles.days}
            role="group"
            aria-label="Choose one date"
          >
            {Array.from({ length: 42 }, (_, i) => shifted(monday, i)).map(
              (date) => (
                <button
                  key={date}
                  type="button"
                  data-date={date}
                  disabled={date < min}
                  tabIndex={date === focus ? 0 : -1}
                  aria-label={label(date)}
                  aria-pressed={draft === date}
                  className={
                    date.slice(5, 7) !== display.slice(5, 7)
                      ? styles.outside
                      : undefined
                  }
                  onClick={() => {
                    setDraft(date);
                    setFocus(date);
                  }}
                  onKeyDown={(event) => key(event, date)}
                >
                  {Number(date.slice(-2))}
                </button>
              ),
            )}
          </div>
        </>
      ) : (
        <div className={styles.choices}>
          {Array.from({ length: 12 }, (_, i) => (
            <button
              type="button"
              key={i}
              aria-pressed={view === "year" ? yearStart + i === year : i === month}
              onClick={() => {
                const next = iso(
                  new Date(
                    Date.UTC(
                      view === "year" ? yearStart + i : year,
                      view === "month" ? i : month,
                      1,
                    ),
                  ),
                );
                setDisplay(next);
                setFocus(next < min ? min : next);
                setView(view === "year" ? "month" : "day");
              }}
            >
              {view === "year" ? yearStart + i : months[i]}
            </button>
          ))}
        </div>
      )}
      <p className={styles.draft} aria-live="polite">
        {draft ? `Selected: ${label(draft)}` : "No date selected"}
      </p>
      <div className={styles.actions}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={!draft || draft < min}
          onClick={() => {
            if (!draft || draft < min) return;
            onChange(draft);
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </dialog>
  );
}
