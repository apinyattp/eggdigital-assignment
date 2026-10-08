"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MeetingStatus } from "@/api/meetings";
import type { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
import styles from "../meeting-lifecycle.module.css";
import detailStyles from "../meeting-detail.module.css";

// MeetingDetail owns the hook above access/loading returns, retaining in-flight
// state when L4 checks temporarily hide these presentation components.
export function MeetingLifecycleActions({
  meetingId,
  creatorId,
  status,
  returnDate,
  lifecycle,
  onMeetingChanged,
  onUnavailable,
  joinUrl,
}: {
  lifecycle: ReturnType<typeof useMeetingLifecycle>;
  joinUrl?: string | null;
  meetingId: string;
  creatorId: string;
  status: MeetingStatus;
  returnDate?: string;
  onMeetingChanged: () => void;
  onUnavailable: () => void;
}) {
  const router = useRouter(),
    handled = useRef(false);
  const listHref = `/dashboard${returnDate ? `?date=${encodeURIComponent(returnDate)}` : ""}`;
  useEffect(() => {
    if (lifecycle.phase !== "complete" && lifecycle.phase !== "unavailable") {
      handled.current = false;
      return;
    }
    if (handled.current) return;
    handled.current = true;
    lifecycle.close();
    if (lifecycle.phase === "unavailable") onUnavailable();
    else if (lifecycle.action === "delete") router.replace(listHref);
    else onMeetingChanged();
  }, [lifecycle, onMeetingChanged, onUnavailable, router, listHref]);
  const isCreator = lifecycle.visible && lifecycle.owner === creatorId;
  if (!isCreator && !joinUrl) return null;
  return (
    <section
      className={`${styles.actions} ${detailStyles.creatorActions}`}
      aria-label="Meeting actions"
    >
      {joinUrl && (
        <a
          className={detailStyles.joinMeeting}
          href={joinUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>Join Meeting</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 4h6v16h-6M3 12h12m-4-4 4 4-4 4" />
          </svg>
        </a>
      )}
      {isCreator && lifecycle.phase === "idle" && (
        <Link
          className={detailStyles.meetingEdit}
          href={`/meetings/${encodeURIComponent(meetingId)}/edit${returnDate ? `?date=${encodeURIComponent(returnDate)}` : ""}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5" />
          </svg>
          <span className={detailStyles.actionLabel}>Edit Meeting</span>
        </Link>
      )}
      {isCreator && status !== "CANCELLED" && (
        <button
          className={detailStyles.meetingCancel}
          type="button"
          disabled={lifecycle.phase !== "idle"}
          onClick={() => {
            void lifecycle.prepare("cancel", creatorId);
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
          <span className={detailStyles.actionLabel}>Cancel Meeting</span>
        </button>
      )}
      {isCreator && lifecycle.action && lifecycle.phase !== "idle" && (
        <Confirmation
          lifecycle={lifecycle}
          listHref={listHref}
          onUseLatest={() => {
            lifecycle.useLatest();
            onMeetingChanged();
          }}
        />
      )}
    </section>
  );
}
export function MeetingDeleteAction({
  lifecycle,
  creatorId,
}: {
  lifecycle: ReturnType<typeof useMeetingLifecycle>;
  creatorId: string;
}) {
  if (!lifecycle.visible || lifecycle.owner !== creatorId) return null;
  return (
    <section
      className={`${styles.dangerZone} ${detailStyles.deleteRow}`}
      aria-label="Delete meeting record"
    >
      <div>
        <strong>Delete meeting record</strong>
        <p>Delete this meeting and its associated data.</p>
      </div>
      <button
        type="button"
        className={styles.danger}
        disabled={lifecycle.phase !== "idle"}
        onClick={() => {
          void lifecycle.prepare("delete", creatorId);
        }}
      >
        Delete Meeting
      </button>
    </section>
  );
}
function Confirmation({
  lifecycle,
  listHref,
  onUseLatest,
}: {
  lifecycle: ReturnType<typeof useMeetingLifecycle>;
  listHref: string;
  onUseLatest: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    lastFocus = useRef<Element | null>(null);
  const canClose =
    ["loading", "read-error", "confirm", "complete", "unavailable"].includes(
      lifecycle.phase,
    ) && !lifecycle.writePending;
  useEffect(() => {
    const element = dialog.current!;
    lastFocus.current = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (lastFocus.current instanceof HTMLElement) lastFocus.current.focus();
    };
  }, []);
  const deleting = lifecycle.action === "delete",
    meeting = lifecycle.latest ?? lifecycle.meeting;
  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${detailStyles.lifecycleDialog} ${deleting ? styles.deleteDialog : ""}`}
      aria-labelledby="lifecycle-title"
      onCancel={(event) => {
        event.preventDefault();
        if (canClose) {
          lifecycle.close();
        }
      }}
    >
      <h2 id="lifecycle-title">
        {deleting ? "Delete Meeting" : "Cancel Meeting"}
      </h2>
      {meeting && (
        <p>
          <strong>{meeting.title}</strong>
          <br />
          {meeting.candidate.name}
        </p>
      )}
      {lifecycle.phase === "loading" && (
        <p role="status">Checking the latest meeting details…</p>
      )}
      {lifecycle.phase === "read-error" && (
        <div role="alert">
          <p>Unable to load meeting details. No data has been changed.</p>
          <button
            type="button"
            onClick={() => {
              void lifecycle.retry();
            }}
          >
            Retry loading
          </button>
        </div>
      )}
      {lifecycle.phase === "confirm" && (
        <>
          <p className={styles.confirmationNote}>
            {deleting
              ? "Delete this meeting and its associated data, including its Interview Notes and Feedback. Select Keep Meeting to keep them."
              : "Change the meeting status to Cancelled while keeping its details, team, Interview Notes, and Feedback."}
          </p>
          {lifecycle.error && (
            <p role="alert">
              Unable to complete the action. Check the information and try
              again.
            </p>
          )}
          <div className={styles.buttons}>
            <button type="button" onClick={lifecycle.close}>
              Keep Meeting
            </button>
            <button
              type="button"
              className={deleting ? styles.danger : styles.primary}
              onClick={() => {
                void lifecycle.confirm();
              }}
            >
              {deleting ? "Confirm Delete" : "Confirm Cancel"}
            </button>
          </div>
        </>
      )}
      {lifecycle.phase === "saving" && (
        <p role="status">
          {deleting ? "Deleting meeting…" : "Cancelling meeting…"}
        </p>
      )}
      {lifecycle.phase === "readback" && (
        <p role="status">Cancellation saved. Loading the saved details…</p>
      )}
      {lifecycle.phase === "readback-error" && (
        <div role="alert">
          <p>
            Cancellation was saved, but the saved details could not be loaded.
            Retrying will only read the details.
          </p>
          <button
            type="button"
            onClick={() => {
              void lifecycle.retry();
            }}
          >
            Reload saved details
          </button>
        </div>
      )}
      {["unknown", "conflict", "reconcile-error"].includes(lifecycle.phase) && (
        <div role="alert">
          <p>
            {lifecycle.phase === "conflict"
              ? "The meeting has changed. Load the latest details before confirming again."
              : "The previous request is not yet confirmed. Read the current status before deciding again."}
          </p>
          <button
            type="button"
            disabled={lifecycle.writePending}
            onClick={() => {
              void lifecycle.retry();
            }}
          >
            {lifecycle.writePending
              ? "Waiting for the original request…"
              : "Check latest details"}
          </button>
        </div>
      )}
      {lifecycle.phase === "reconciling" && (
        <p role="status">
          Loading the latest details without repeating the request…
        </p>
      )}
      {lifecycle.phase === "reconcile" && lifecycle.latest && (
        <>
          <p>
            Current saved status: <strong>{lifecycle.latest.status}</strong>{" "}
            This does not confirm who made the change.
          </p>
          <div className={styles.buttons}>
            <button type="button" onClick={onUseLatest}>
              Use current details and go back
            </button>
            {(deleting || lifecycle.latest.status !== "CANCELLED") && (
              <button type="button" onClick={lifecycle.reviewLatest}>
                Use latest details to confirm again
              </button>
            )}
          </div>
        </>
      )}
      {lifecycle.phase === "unavailable" && (
        <div role="alert">
          <p>
            Meeting not found or you do not have access. This result does not
            confirm who deleted the meeting.
          </p>
          <Link href={listHref}>Back to meetings</Link>
        </div>
      )}
      {lifecycle.phase === "complete" && (
        <p role="status">
          {deleting
            ? "Meeting deleted. Returning to meetings…"
            : "Cancellation saved. Check the latest meeting status."}
        </p>
      )}
      {canClose && lifecycle.phase !== "confirm" && (
        <button type="button" onClick={lifecycle.close}>
          Close
        </button>
      )}
    </dialog>
  );
}
