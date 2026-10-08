"use client";
import type { useMeetingEdit } from "@/hooks/useMeetingEdit";
import styles from "../meeting-detail.module.css";

/** Creator-only Detail controls reuse the existing versioned Edit command/recovery. */
export function MeetingStatusActions({
  edit,
  currentTime,
  onChanged,
}: {
  edit: ReturnType<typeof useMeetingEdit>;
  currentTime: number;
  onChanged: () => void;
}) {
  if (edit.phase === "denied") return null;
  const meeting = edit.meeting;
  const eligible =
    !!meeting &&
    meeting.status !== "CANCELLED" &&
    Date.parse(meeting.endsAt) > currentTime;
  const busy = [
    "saving",
    "readback",
    "loading",
    "conflict-loading",
    "reconciling",
  ].includes(edit.phase);
  function saveSelectedMeetingStatus(status: "CONFIRMED" | "REJECTED", clickedAt: number) {
    if (
      !eligible ||
      edit.locked ||
      !meeting ||
      meeting.status === status ||
      Date.parse(meeting.endsAt) <= clickedAt
    )
      return;
    edit.change("status", status);
    void edit.save();
  }
  return (
    <div className={styles.statusSaveGroup}>
      {eligible && (
        <div className={styles.statusActions} data-saving={busy}>
          {(
            [
              ["CONFIRMED", "Confirm"],
              ["REJECTED", "Reject"],
            ] as const
          ).map(([status, label]) => (
            <button
              key={status}
              type="button"
              className={
                status === "CONFIRMED"
                  ? styles.statusConfirm
                  : styles.statusReject
              }
              aria-pressed={meeting.status === status}
              aria-busy={busy && edit.draft?.status === status}
              disabled={edit.locked}
              onClick={() => saveSelectedMeetingStatus(status, Date.now())}
            >
              {busy && edit.draft?.status === status ? (
                <span className={styles.saveSpinner} aria-hidden="true" />
              ) : (
                meeting.status !== status && (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d={
                        status === "CONFIRMED"
                          ? "m5 12 4 4L19 6"
                          : "m6 6 12 12M18 6 6 18"
                      }
                    />
                  </svg>
                )
              )}
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      {busy && (
        <p className={styles.help} role="status">
          {edit.phase === "saving"
            ? "Saving meeting status…"
            : "Loading meeting status…"}
        </p>
      )}
      {!!Object.keys(edit.fields).length && (
        <p className={styles.error} role="alert">
          Unable to save the status. Review the meeting details and try again.
        </p>
      )}
      {edit.phase === "error" && (
        <div className={styles.error} role="alert">
          <p>Unable to load the current meeting status.</p>
          <button type="button" onClick={() => void edit.retry()}>
            Retry loading status
          </button>
        </div>
      )}
      {["unknown", "reconcile-error", "readback-error"].includes(
        edit.phase,
      ) && (
        <div className={styles.error} role="alert">
          <p>
            {edit.phase === "readback-error"
              ? "Saved, but the saved status could not be loaded. Reload without saving again."
              : "The previous save result is not confirmed. Read the current status before trying again."}
          </p>
          <button
            type="button"
            disabled={edit.writePending}
            onClick={() => void edit.retry()}
          >
            Check saved status
          </button>
        </div>
      )}
      {["conflict", "conflict-error"].includes(edit.phase) && !edit.latest && (
        <div className={styles.error} role="alert">
          <p>
            The meeting changed. Load its latest status before choosing again.
          </p>
          <button type="button" onClick={() => void edit.loadLatest()}>
            Load latest status
          </button>
        </div>
      )}
      {edit.latest && (
        <div className={styles.error} role="alert">
          <p>
            Current saved status: {edit.latest.status}. This does not confirm
            the previous request.
          </p>
          <button
            type="button"
            onClick={() => {
              edit.resolve(false);
              onChanged();
            }}
          >
            Use current status
          </button>
        </div>
      )}
    </div>
  );
}
