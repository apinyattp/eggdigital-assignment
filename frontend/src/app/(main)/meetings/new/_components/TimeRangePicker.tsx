"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Picker from "react-mobile-picker";
import styles from "../date-time-picker.module.css";
import "../time-range.css";
const options = {
  hour: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")),
  minute: Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")),
};
const split = (time: string) => ({
  hour: time.split(":")[0],
  minute: time.split(":")[1],
});
const text = (time: { hour: string; minute: string }) =>
  `${time.hour}:${time.minute}`;
export function TimeRangePicker({
  start,
  end,
  disabled,
  onChange,
}: {
  start: string;
  end: string;
  disabled: boolean;
  onChange: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState<"pointer" | "keyboard" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        id="meeting-time-range"
        type="button"
        className={styles.range}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-labelledby="time-range-label time-range-value"
        onClick={(event) => setOpen(event.detail === 0 ? "keyboard" : "pointer")}
      >
        <span id="time-range-value">
          {start} – {end}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      {open && !disabled && (
        <TimeDialog
          start={start}
          end={end}
          pointerOpened={open === "pointer"}
          onClose={() => {
            setOpen(null);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
          onChange={onChange}
        />
      )}
    </>
  );
}
function TimeDialog({
  start,
  end,
  pointerOpened,
  onClose,
  onChange,
}: {
  start: string;
  end: string;
  onClose: () => void;
  onChange: (start: string, end: string) => void;
  pointerOpened: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pointerFocus, setPointerFocus] = useState(pointerOpened);
  const [draft, setDraft] = useState({ start: split(start), end: split(end) });
  const [active, setActive] = useState<"start" | "end">("start");
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
    return () => element.close();
  }, []);
  function key(event: KeyboardEvent, name: "hour" | "minute") {
    const values = options[name],
      index = values.indexOf(draft[active][name]);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? values.length - 1
          : event.key === "ArrowDown"
            ? Math.min(values.length - 1, index + 1)
            : event.key === "ArrowUp"
              ? Math.max(0, index - 1)
              : null;
    if (next !== null) {
      event.preventDefault();
      setDraft((previous) => ({
        ...previous,
        [active]: { ...previous[active], [name]: values[next] },
      }));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="time-range-dialog"
      data-pointer-focus={pointerFocus || undefined}
      onPointerDownCapture={() => setPointerFocus(true)}
      onKeyDownCapture={() => setPointerFocus(false)}
      aria-labelledby="range-picker-title"
      aria-describedby="range-picker-context"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="range-sheet">
        <button
          type="button"
          className="range-close"
          aria-label="Close without saving"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="range-picker-title">Meeting time</h2>
        <p id="range-picker-context">Bangkok (UTC+7) · 24-hour time</p>
        <div
          className="range-tabs"
          role="tablist"
          aria-label="Choose time to edit"
        >
          {(["start", "end"] as const).map((which) => (
            <button
              key={which}
              type="button"
              id={`range-tab-${which}`}
              role="tab"
              aria-selected={active === which}
              aria-controls="range-wheel-panel"
              tabIndex={active === which ? 0 : -1}
              onClick={() => setActive(which)}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? "start"
                      : event.key === "End"
                        ? "end"
                        : which === "start"
                          ? "end"
                          : "start";
                  setActive(next);
                  dialog.current
                    ?.querySelector<HTMLButtonElement>(`#range-tab-${next}`)
                    ?.focus();
                }
              }}
            >
              {which === "start" ? "Start time" : "End time"}
              <strong>{text(draft[which])}</strong>
            </button>
          ))}
        </div>
        <section
          id="range-wheel-panel"
          role="tabpanel"
          aria-labelledby={`range-tab-${active}`}
        >
          <div className="column-labels" aria-hidden="true">
            <span>Hour</span>
            <span>Minute</span>
          </div>
          <div className="wheel-window">
            <div className="selection-band" aria-hidden="true" />
            <Picker
              key={active}
              value={draft[active]}
              onChange={(value) =>
                setDraft((previous) => ({ ...previous, [active]: value }))
              }
              wheelMode="normal"
              height={220}
              itemHeight={44}
              className="wheel-picker"
            >
              {(["hour", "minute"] as const).map((name) => (
                <div
                  key={name}
                  className="wheel-column"
                  role="spinbutton"
                  tabIndex={0}
                  aria-label={name === "hour" ? "Hour" : "Minute"}
                  aria-valuemin={0}
                  aria-valuemax={name === "hour" ? 23 : 59}
                  aria-valuenow={Number(draft[active][name])}
                  aria-valuetext={draft[active][name]}
                  onKeyDown={(event) => key(event, name)}
                >
                  <Picker.Column name={name} className="wheel-track">
                    {options[name].map((value) => (
                      <Picker.Item key={value} value={value} aria-hidden="true">
                        {({ selected }) => (
                          <span
                            className={`wheel-item${selected ? " selected" : ""}`}
                          >
                            {value}
                          </span>
                        )}
                      </Picker.Item>
                    ))}
                  </Picker.Column>
                </div>
              ))}
            </Picker>
          </div>
        </section>
        <p className="range-summary" aria-live="polite">
          {text(draft.start)} – {text(draft.end)}
        </p>
        <p className="range-help">
          Select Done to confirm both the start and end times.
        </p>
        <div className="range-actions">
          <button type="button" className="range-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="range-done"
            onClick={() => {
              onChange(text(draft.start), text(draft.end));
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
