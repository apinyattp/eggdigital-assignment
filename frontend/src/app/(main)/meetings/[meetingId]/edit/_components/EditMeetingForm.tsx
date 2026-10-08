"use client";
import { WorkspaceLoading } from "@/app/(main)/_components/WorkspaceLoading";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SaveToast } from "@/components/ui/SaveToast";
import { authController } from "@/hooks/authController";
import { useCurrentIdentity } from "@/hooks/useAuth";
import { useMeetingEdit, type EditFields } from "@/hooks/useMeetingEdit";
import { EditTeamPicker } from "./EditTeamPicker";
import styles from "../edit-meeting.module.css";
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

export function EditMeetingForm({
  meetingId,
  returnDate,
}: {
  meetingId: string;
  returnDate?: string;
}) {
  const auth = useCurrentIdentity(),
    edit = useMeetingEdit(meetingId),
    formElement = useRef<HTMLFormElement>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);
  const [dismissedErrorAttempt, setDismissedErrorAttempt] = useState(0);
  const [toastDismissed, setToastDismissed] = useState(false);
  const dismissToast = useCallback(() => setToastDismissed(true), []);
  const hasErrors = Object.keys(edit.fields).length > 0;
  useEffect(() => {
    if (hasErrors && submitAttempt > 0) {
      formElement.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
        ?.focus();
    }
  }, [hasErrors, submitAttempt]);
  const summaryHref = `/meetings/${encodeURIComponent(meetingId)}${returnDate ? `?date=${encodeURIComponent(returnDate)}` : ""}`,
    back = (
      <Link className={styles.back} href={summaryHref}>
        ← Back
      </Link>
    );
  if (!auth.checked || auth.status === "checking")
    return (
      <main className={styles.shell}>
        <WorkspaceLoading message="Checking your account…" />
      </main>
    );
  if (auth.usableSession?.user.membership !== "member")
    return (
      <main className={styles.shell}>
        <h1>Edit Meeting</h1>
        <p role="alert">Only the meeting creator can edit these details.</p>
        {auth.status === "error" && (
          <button
            type="button"
            onClick={() => {
              void authController.refresh();
            }}
          >
            Check account again
          </button>
        )}
        {back}
      </main>
    );
  if (edit.phase === "denied")
    return (
      <main className={styles.shell}>
        <h1>Meeting not found or you do not have permission to edit it.</h1>
        {back}
      </main>
    );
  if (edit.phase === "loading")
    return (
      <main className={styles.shell}>
        <WorkspaceLoading message="Loading meeting details…" />
        {back}
      </main>
    );
  if (!edit.meeting || !edit.draft)
    return (
      <main className={styles.shell}>
        <h1>Unable to load meeting details.</h1>
        <button
          type="button"
          onClick={() => {
            void edit.retry();
          }}
        >
          Retry loading meeting details
        </button>
        {back}
      </main>
    );
  const { meeting, draft, latest } = edit;
  const field = (
    key: Exclude<keyof EditFields, "status">,
    label: string,
    required = false,
    multiline = false,
    type = "text",
  ) => (
    <div
      key={key}
      className={
        key === "candidateEmail" ||
        key === "position" ||
        key === "location" ||
        key === "joinUrl"
          ? styles.field
          : styles.wide
      }
    >
      <label htmlFor={key}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          id={key}
          value={draft[key]}
          disabled={edit.locked}
          onChange={(event) => edit.change(key, event.target.value)}
          aria-invalid={!!edit.fields[key] || undefined}
          aria-describedby={edit.fields[key] ? `${key}-error` : undefined}
        />
      ) : (
        <input
          id={key}
          type={type}
          value={draft[key]}
          required={required}
          disabled={edit.locked}
          onChange={(event) => edit.change(key, event.target.value)}
          aria-invalid={!!edit.fields[key] || undefined}
          aria-describedby={edit.fields[key] ? `${key}-error` : undefined}
        />
      )}
      {edit.fields[key] && (
        <p id={`${key}-error`} className={styles.error}>
          {edit.fields[key]}
        </p>
      )}
    </div>
  );
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>03 / EDIT MEETING</div>
          <h1>Edit Meeting</h1>
          <p className={styles.help}>
            Edit the meeting details and review them before saving.
          </p>
        </div>
        {!edit.locked && back}
      </header>
      <div className={styles.layout}>
        <form
          ref={formElement}
          className={styles.panel}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setToastDismissed(false);
            setSubmitAttempt((attempt) => attempt + 1);
            void edit.save();
          }}
          aria-busy={edit.phase === "saving" || edit.phase === "readback"}
        >
          {hasErrors && submitAttempt > dismissedErrorAttempt && (
            <SaveToast
              key={submitAttempt}
              variant="error"
              message={`Check ${Object.keys(edit.fields).length} ${Object.keys(edit.fields).length === 1 ? "field" : "fields"} before saving.`}
              onDismiss={() => setDismissedErrorAttempt(submitAttempt)}
            />
          )}
          {edit.saved && edit.phase === "ready" && !toastDismissed && (
            <SaveToast
              message="Meeting changes saved."
              onDismiss={dismissToast}
            />
          )}
          {edit.phase === "saving" && (
            <p role="status">Saving meeting details and team…</p>
          )}
          {edit.phase === "readback" && (
            <p role="status">Loading the saved details…</p>
          )}
          {(edit.phase === "unknown" || edit.phase === "reconcile-error") && (
            <div className={styles.notice} role="alert">
              <p>
                The save result is not yet confirmed. Your draft is preserved.
                Load the latest details before deciding whether to save again.
              </p>
              <button
                type="button"
                disabled={edit.writePending}
                onClick={() => {
                  void edit.retry();
                }}
              >
                {edit.writePending
                  ? "Waiting for the original request…"
                  : "Check latest details"}
              </button>
            </div>
          )}
          {edit.phase === "readback-error" && (
            <div className={styles.notice} role="alert">
              <p>
                Saved, but the saved details could not be loaded. Try loading
                again without saving another time.
              </p>
              <button
                type="button"
                onClick={() => {
                  void edit.retry();
                }}
              >
                Reload saved details
              </button>
            </div>
          )}
          {(edit.phase === "conflict" || edit.phase === "conflict-error") &&
            !latest && (
              <div className={styles.notice} role="alert">
                <p>
                  The meeting has changed. Your draft is preserved. Load the
                  latest details to compare before saving.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void edit.loadLatest();
                  }}
                >
                  Load latest details
                </button>
              </div>
            )}
          {(edit.phase === "conflict-loading" ||
            edit.phase === "reconciling") && (
            <p role="status">
              Loading the latest details. Your draft is preserved…
            </p>
          )}
          {latest && (
            <section className={styles.notice} aria-labelledby="latest-title">
              <h2 id="latest-title">Latest saved details</h2>
              {edit.phase === "reconcile" && (
                <p>
                  These details show the current saved state. They do not
                  confirm that your previous request saved it.
                </p>
              )}
              <dl className={styles.summary}>
                <dt>Candidate</dt>
                <dd>
                  {latest.candidate.name} · {latest.candidate.email}
                </dd>
                <dt>Position</dt>
                <dd>{latest.position}</dd>
                <dt>Title</dt>
                <dd>{latest.title}</dd>
                <dt>Description</dt>
                <dd>{latest.description || "—"}</dd>
                <dt>Preparation Notes</dt>
                <dd>{latest.preparationNotes || "—"}</dd>
                <dt>
                  {latest.format === "ONLINE" ? "Meeting link" : "Location"}
                </dt>
                <dd>
                  {(latest.format === "ONLINE"
                    ? latest.joinUrl
                    : latest.location) || "—"}
                </dd>
                <dt>Status</dt>
                <dd>{latest.status}</dd>
                <dt>Interview team</dt>
                <dd>
                  {latest.attendees.map((person) => (
                    <div key={person.email}>
                      {person.displayName} · {person.email}
                    </div>
                  ))}
                </dd>
              </dl>
              <p>
                Choose the latest details or keep only your draft changes for
                another review. This choice does not save any changes.
              </p>
              <div className={styles.actions}>
                <button type="button" onClick={() => edit.resolve(false)}>
                  Use latest details
                </button>
                <button type="button" onClick={() => edit.resolve(true)}>
                  Keep my draft changes
                </button>
              </div>
            </section>
          )}
          <section className={styles.group} aria-labelledby="candidate-title">
            <h2 id="candidate-title">Candidate</h2>
            <p className={styles.help}>Candidate details for this meeting.</p>
            <div className={styles.fields}>
              {field("candidateName", "Candidate Name", true)}
              {field("candidateEmail", "Candidate Email", true, false, "email")}
              {field("position", "Position", true)}
            </div>
          </section>
          <section className={styles.group} aria-labelledby="meeting-title">
            <h2 id="meeting-title">Meeting details</h2>
            <p className={styles.help}>
              Meeting title, date, time, and status.
            </p>
            <div className={styles.fields}>
              {field("title", "Title", true)}
              {field("description", "Description", false, true)}
              <fieldset
                className={`${styles.schedule} ${styles.wide}`}
                disabled
              >
                <legend>Date &amp; time</legend>
                <div className={styles.fields}>
                  <div className={styles.scheduleField}>
                    <label htmlFor="startDate">Start date</label>
                    <input
                      id="startDate"
                      value={date(meeting.startsAt)}
                      readOnly
                    />
                    <svg
                      className={styles.scheduleIcon}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <rect x="3" y="5" width="18" height="16" rx="3" />
                      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
                    </svg>
                  </div>
                  <div className={styles.scheduleField}>
                    <label htmlFor="endDate">End date</label>
                    <input id="endDate" value={date(meeting.endsAt)} readOnly />
                    <svg
                      className={styles.scheduleIcon}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <rect x="3" y="5" width="18" height="16" rx="3" />
                      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
                    </svg>
                  </div>
                  <div className={`${styles.wide} ${styles.scheduleField}`}>
                    <label htmlFor="timeRange">Start time – End time</label>
                    <input
                      id="timeRange"
                      value={`${time(meeting.startsAt)} – ${time(meeting.endsAt)}`}
                      readOnly
                    />
                    <svg
                      className={styles.scheduleIcon}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                  </div>
                </div>
                <p className={styles.help}>
                  The meeting date and time cannot be changed · Bangkok (UTC+7)
                </p>
              </fieldset>
              <div className={styles.wide}>
                <label htmlFor="status">Status</label>
                <select
                  id="status"
                  disabled={edit.locked}
                  value={draft.status}
                  onChange={(event) =>
                    edit.change(
                      "status",
                      event.target.value as EditFields["status"],
                    )
                  }
                >
                  {["PENDING", "CONFIRMED", "REJECTED", "CANCELLED"].map(
                    (status) => (
                      <option key={status} value={status}>
                        {status.charAt(0) + status.slice(1).toLowerCase()}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
          </section>
          <section className={styles.group} aria-labelledby="format-title">
            <h2 id="format-title">Format &amp; location</h2>
            <p className={styles.help}>Meeting format and joining details.</p>
            <div className={styles.fields}>
              <div className={styles.field}>
                <label htmlFor="format">Meeting type</label>
                <input
                  id="format"
                  value={meeting.format === "ONSITE" ? "Onsite" : "Online"}
                  readOnly
                  disabled
                />
              </div>
              {meeting.format === "ONLINE"
                ? field("joinUrl", "Meeting link", false, false, "url")
                : field("location", "Location (optional)")}
            </div>
            {meeting.format === "ONSITE" && (
              <p className={styles.help}>
                Leave blank if the location is not yet known.
              </p>
            )}
          </section>
          <section className={styles.group} aria-labelledby="team-title">
            <h2 id="team-title">Interview team &amp; preparation</h2>
            <p className={styles.help}>Interviewers and preparation details.</p>
            <EditTeamPicker edit={edit} />
            {field("preparationNotes", "Preparation Notes", false, true)}
            <p className={styles.help}>
              Preparation details are separate from Interview Notes on the
              meeting details page.
            </p>
          </section>
          <p className={`${styles.help} ${styles.formFooterHelp}`}>
            Changes are saved in this app only. No meeting update notifications
            are sent.
          </p>
          <div className={styles.actions}>
            {!edit.locked && (
              <Link className={styles.cancel} href={summaryHref}>
                Cancel
              </Link>
            )}
            <button
              type="submit"
              className={styles.primary}
              disabled={edit.locked}
            >
              Save Meeting
            </button>
          </div>
        </form>
        <aside className={`${styles.panel} ${styles.aside}`}>
          <h2>Prepare for the interview</h2>
          <p>
            Check the candidate name, position, and time, along with the
            participants, before saving.
          </p>
          <p className={styles.help}>
            Editing details does not remove Interview Notes or Feedback.
          </p>
        </aside>
      </div>
    </main>
  );
}
