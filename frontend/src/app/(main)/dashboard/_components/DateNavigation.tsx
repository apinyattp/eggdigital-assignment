"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { dateLabel, monday, shiftDay } from "./dates";
import styles from "../dashboard.module.css";

export function DateNavigation({
  value,
  week,
  onChange,
  onWeekChange,
}: {
  value: string;
  week: string;
  onChange: (date: string) => void;
  onWeekChange: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const weekLabel = new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <>
      <div className={styles.dateHeading}>
        <div>
          <h2>{dateLabel(value)}</h2>
          <span className={styles.dateSubtitle}>
            Meetings for this date · Bangkok (UTC+7)
          </span>
        </div>
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4m8-4v4" />
          </svg>
          Choose date
        </button>
      </div>
      <nav className={styles.week} aria-label="Choose meeting date">
        <button
          type="button"
          aria-label="Previous Week"
          onClick={() => onWeekChange(shiftDay(week, -7))}
        >
          ‹
        </button>
        <span className={styles.weekRange}>Week of {weekLabel}</span>
        <div className={styles.weekStrip}>
          {Array.from({ length: 7 }, (_, index) => shiftDay(week, index)).map(
            (date) => (
              <button
                key={date}
                type="button"
                aria-pressed={value === date}
                aria-label={dateLabel(date)}
                onClick={() => onChange(date)}
              >
                <span>
                  {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </span>
                <strong>{Number(date.slice(-2))}</strong>
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          aria-label="Next Week"
          onClick={() => onWeekChange(shiftDay(week, 7))}
        >
          ›
        </button>
      </nav>
      <p className={styles.weekCaption}>
        Week of {weekLabel}
        {value < week || value > shiftDay(week, 6)
          ? " · Selected date is outside this week"
          : ""}
      </p>
      {open && (
        <Calendar
          value={value}
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
  onChange,
  onClose,
}: {
  value: string;
  onChange: (date: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value),
    [display, setDisplay] = useState(value.slice(0, 7) + "-01"),
    [focus, setFocus] = useState(value);
  const [view, setView] = useState<"day" | "month" | "year">("day");
  const year = Number(display.slice(0, 4)),
    month = Number(display.slice(5, 7)) - 1,
    yearStart = Math.floor(year / 12) * 12;
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
      ?.querySelector<HTMLButtonElement>(
        view === "day" ? `[data-date="${focus}"]` : "[data-calendar-choice]",
      )
      ?.focus();
  }, [focus, display, view]);
  function move(step: number) {
    const next = new Date(
      Date.UTC(
        year + (view === "year" ? step * 12 : view === "month" ? step : 0),
        month + (view === "day" ? step : 0),
        1,
      ),
    )
      .toISOString()
      .slice(0, 10);
    setDisplay(next);
    setFocus(next);
  }
  function key(event: KeyboardEvent, date: string) {
    const shifts: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    let next =
      shifts[event.key] === undefined
        ? null
        : shiftDay(date, shifts[event.key]);
    if (event.key === "Home") next = monday(date);
    if (event.key === "End") next = shiftDay(monday(date), 6);
    if (event.key === "PageUp" || event.key === "PageDown")
      next = new Date(
        Date.UTC(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1 + (event.key === "PageUp" ? -1 : 1),
          Number(date.slice(-2)),
        ),
      )
        .toISOString()
        .slice(0, 10);
    if (next) {
      event.preventDefault();
      setFocus(next);
      setDisplay(next.slice(0, 7) + "-01");
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.datePicker}`}
      aria-labelledby="dashboard-date-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="dashboard-date-title">Choose date</h2>
      <div className={styles.calendarNavigation}>
        <button
          type="button"
          aria-label={`Previous ${view === "day" ? "month" : view === "month" ? "year" : "years"}`}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <div>
          {view === "day" ? (
            <>
              <button
                type="button"
                className={styles.pickerHeading}
                aria-label="Select month"
                onClick={() => setView("month")}
              >
                {months[month]}
              </button>
              <button
                type="button"
                className={styles.pickerHeading}
                aria-label="Select year"
                onClick={() => setView("year")}
              >
                {year}
              </button>
            </>
          ) : view === "month" ? (
            <button
              type="button"
              className={styles.pickerHeading}
              aria-label="Select year"
              onClick={() => setView("year")}
            >
              {year} · Select month
            </button>
          ) : (
            <strong>
              {yearStart}–{yearStart + 11}
            </strong>
          )}
        </div>
        <button
          type="button"
          aria-label={`Next ${view === "day" ? "month" : view === "month" ? "year" : "years"}`}
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
            {Array.from({ length: 42 }, (_, i) =>
              shiftDay(monday(display), i),
            ).map((date) => (
              <button
                key={date}
                type="button"
                data-date={date}
                tabIndex={date === focus ? 0 : -1}
                aria-label={dateLabel(date)}
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
            ))}
          </div>
        </>
      ) : (
        <div className={styles.choices}>
          {Array.from({ length: 12 }, (_, i) => (
            <button
              type="button"
              key={i}
              data-calendar-choice
              aria-pressed={
                view === "year" ? yearStart + i === year : i === month
              }
              onClick={() => {
                const next = new Date(
                  Date.UTC(
                    view === "year" ? yearStart + i : year,
                    view === "month" ? i : month,
                    1,
                  ),
                )
                  .toISOString()
                  .slice(0, 10);
                setDisplay(next);
                setFocus(next);
                setView(view === "year" ? "month" : "day");
              }}
            >
              {view === "year" ? yearStart + i : months[i]}
            </button>
          ))}
        </div>
      )}
      <p className={styles.pickerDraft} aria-live="polite">
        Selected: {dateLabel(draft)}
      </p>
      <div className={styles.pickerActions}>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
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
