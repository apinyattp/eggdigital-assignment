"use client";
import { useEffect, useRef } from "react";
import styles from "./SaveToast.module.css";

/** Callers own confirmed outcome and validation state; this component only presents it. */
export function SaveToast({
  message,
  onDismiss,
  variant = "success",
}: {
  message: string;
  variant?: "success" | "error";
  onDismiss: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const dismiss = useRef(onDismiss);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const start = () => {
    clear();
    timer.current = setTimeout(() => dismiss.current(), 4000);
  };
  useEffect(() => {
    priorFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.classList.add("saved-toast-visible");
    timer.current = setTimeout(() => dismiss.current(), 4000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.body.classList.remove("saved-toast-visible");
    };
  }, [message]);
  return (
    <div
      ref={root}
      className={`${styles.toast} ${variant === "error" ? styles.error : ""}`}
      onFocus={clear}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) start();
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" />
          {variant === "error" ? (
            <path d="M12 7v6m0 4h.01" />
          ) : (
            <path d="m8 12 3 3 5-6" />
          )}
        </svg>
      </span>
      <div
        className={styles.message}
        role={variant === "error" ? "alert" : "status"}
        aria-live={variant === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <strong>{message}</strong>
      </div>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss notification"
        onClick={() => {
          clear();
          dismiss.current();
          if (priorFocus.current?.isConnected)
            priorFocus.current.focus({ preventScroll: true });
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
    </div>
  );
}
