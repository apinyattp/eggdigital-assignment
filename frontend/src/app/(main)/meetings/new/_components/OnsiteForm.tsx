"use client";
import { WorkspaceLoading } from "@/app/(main)/_components/WorkspaceLoading";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SaveToast } from "@/components/ui/SaveToast";
import { useRouter } from "next/navigation";
import { authController } from "@/hooks/authController";
import {
  bangkokToday,
  useOnsiteForm,
  type OnsiteFormValues,
} from "@/hooks/useOnsiteForm";
import { TeamPicker } from "./TeamPicker";
import { DatePicker } from "./DatePicker";
import { TimeRangePicker } from "./TimeRangePicker";
import styles from "../onsite-form.module.css";

export function OnsiteForm() {
  const form = useOnsiteForm(),
    { auth, save, values, errors } = form;
  const session = auth.usableSession;
  const formElement = useRef<HTMLFormElement>(null);
  const [submitAttempt, setSubmitAttempt] = useState(0);
  const [dismissedAttempt, setDismissedAttempt] = useState(0);
  const router = useRouter();
  const redirectedMeeting = useRef<string | null>(null);
  const hasErrors = Object.keys(errors).length > 0;
  useEffect(() => {
    if (hasErrors && submitAttempt > 0) {
      formElement.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')
        ?.focus();
    }
  }, [hasErrors, submitAttempt]);
  useEffect(() => {
    if (
      save.phase !== "saved" ||
      !save.meeting ||
      auth.status !== "authenticated" ||
      auth.pending ||
      auth.logoutRequired ||
      auth.session?.user.membership !== "member" ||
      auth.session.user.id !== save.meeting.creatorId ||
      redirectedMeeting.current === save.meeting.id
    )
      return;
    redirectedMeeting.current = save.meeting.id;
    router.replace(`/meetings/${encodeURIComponent(save.meeting.id)}`);
  }, [
    save.phase,
    save.meeting,
    auth.status,
    auth.pending,
    auth.logoutRequired,
    auth.session,
    router,
  ]);
  if (!auth.checked || auth.status === "checking")
    return (
      <main className={styles.shell}>
        <WorkspaceLoading message="Checking your account…" />
      </main>
    );
  if (session?.user.membership !== "member")
    return (
      <main className={styles.shell}>
        <h1>Add New Meeting</h1>
        <p role="alert">
          Sign in with a company member account to create a meeting.
        </p>
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
        <Link href="/dashboard">Back to meetings</Link>
      </main>
    );
  const field = (
    key: keyof OnsiteFormValues,
    label: string,
    required = false,
    multiline = false,
    type = "text",
  ) => (
    <div
      className={
        key === "candidateEmail" ||
        key === "position" ||
        key === "location" ||
        key === "joinUrl"
          ? styles.field
          : styles.wide
      }
      key={key}
    >
      <label htmlFor={key}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {multiline ? (
        <textarea
          id={key}
          value={values[key]}
          disabled={save.locked}
          onChange={(event) => form.change(key, event.target.value)}
          aria-invalid={!!errors[key] || undefined}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        />
      ) : (
        <input
          id={key}
          type={type}
          value={values[key]}
          required={required}
          disabled={save.locked}
          onChange={(event) => form.change(key, event.target.value)}
          aria-invalid={!!errors[key] || undefined}
          aria-describedby={errors[key] ? `${key}-error` : undefined}
        />
      )}
      {errors[key] && (
        <p className={styles.error} id={`${key}-error`}>
          {errors[key]}
        </p>
      )}
    </div>
  );
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BOOKING FORM</p>
          <h1>Schedule a New Meeting</h1>
          <p className={styles.help}>
            Enter the candidate details and interview schedule.
          </p>
        </div>
        {!save.locked || save.phase === "saved" ? (
          <Link href="/dashboard">← Back</Link>
        ) : (
          <span>{session.user.displayName}</span>
        )}
      </header>
      {save.phase === "saved" && save.meeting ? (
        <p role="status">Opening meeting details…</p>
      ) : save.phase === "deleted" ? (
        <section className={styles.panel}>
          <p role="alert">
            The meeting for this request was deleted and cannot be saved again.
            To create a new meeting, start a new booking from the meetings page.
          </p>
          <Link href="/dashboard">Back to meetings</Link>
        </section>
      ) : (
        <div className={styles.layout}>
          <form
            ref={formElement}
            className={styles.panel}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitAttempt((attempt) => attempt + 1);
              form.submit();
            }}
            aria-busy={save.phase === "saving" || save.phase === "reading"}
          >
            {hasErrors && submitAttempt > dismissedAttempt && (
              <SaveToast
                key={submitAttempt}
                variant="error"
                message={`Check ${Object.keys(errors).length} ${Object.keys(errors).length === 1 ? "field" : "fields"} before saving.`}
                onDismiss={() => setDismissedAttempt(submitAttempt)}
              />
            )}
            {save.phase === "rejected" && !hasErrors && (
              <p role="alert" className={styles.alert}>
                Unable to save. Check the information and try again.
              </p>
            )}
            {(save.phase === "unknown" || save.phase === "read-error") && (
              <div role="alert" className={styles.alert}>
                <p>
                  {save.phase === "unknown"
                    ? form.format === "ONLINE"
                      ? "Meeting creation is not yet confirmed. Check the original request before editing or creating another meeting."
                      : "The save result is not yet confirmed. Check the original request before editing or creating another meeting."
                    : "The meeting was saved, but its saved details could not be loaded."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void save.retry();
                  }}
                >
                  {save.phase === "unknown"
                    ? "Check save result again"
                    : "Retry loading"}
                </button>
              </div>
            )}
            {(save.phase === "saving" || save.phase === "reading") && (
              <p role="status">
                {save.phase === "saving"
                  ? "Saving the meeting and team…"
                  : "Saved. Loading the saved details…"}
              </p>
            )}
            <section className={styles.group} aria-labelledby="candidate-title">
              <h2 id="candidate-title">Candidate</h2>
              <p className={styles.help}>Candidate details for this meeting.</p>
              <div className={styles.fields}>
                {field("candidateName", "Candidate Name", true)}
                {field(
                  "candidateEmail",
                  "Candidate Email",
                  true,
                  false,
                  "email",
                )}
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
                  disabled={save.locked}
                >
                  <legend>Date &amp; time</legend>
                  <div className={styles.fields}>
                    {(["startDate", "endDate"] as const).map((key, i) => (
                      <div className={styles.field} key={key}>
                        <label htmlFor={key}>
                          {i === 0 ? "Start date" : "End date"}{" "}
                          <span aria-hidden="true">*</span>
                        </label>
                        <DatePicker
                          id={key}
                          value={values[key]}
                          min={
                            key === "endDate" &&
                            values.startDate > bangkokToday()
                              ? values.startDate
                              : bangkokToday()
                          }
                          disabled={save.locked}
                          invalid={!!errors[key]}
                          onChange={(date) => form.change(key, date)}
                        />
                        {errors[key] && (
                          <p className={styles.error}>{errors[key]}</p>
                        )}
                      </div>
                    ))}
                    <div className={styles.wide}>
                      <label id="time-range-label" htmlFor="meeting-time-range">
                        Start time – End time <span aria-hidden="true">*</span>
                      </label>
                      <TimeRangePicker
                        start={values.start}
                        end={values.end}
                        disabled={save.locked}
                        onChange={(start, end) => {
                          form.change("start", start);
                          form.change("end", end);
                        }}
                      />
                      <p className={styles.help}>
                        Start date: today or later · End time: in the future and
                        after the start time · Bangkok (UTC+7)
                      </p>
                      {(errors.start ||
                        errors.end ||
                        errors.startsAt ||
                        errors.endsAt) && (
                        <p className={styles.error}>
                          {errors.start ||
                            errors.end ||
                            errors.startsAt ||
                            errors.endsAt}
                        </p>
                      )}
                    </div>
                  </div>
                </fieldset>
                <div className={styles.wide}>
                  <label htmlFor="status">Status</label>
                  <select
                    id="status"
                    disabled={save.locked}
                    value={values.status}
                    onChange={(event) =>
                      form.change(
                        "status",
                        event.target.value as OnsiteFormValues["status"],
                      )
                    }
                  >
                    <option value="PENDING">Pending</option>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="REJECTED">Rejected</option>
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
                  <select
                    id="format"
                    value={form.format}
                    disabled={save.locked}
                    onChange={(event) =>
                      form.changeFormat(
                        event.target.value as "ONSITE" | "ONLINE",
                      )
                    }
                  >
                    <option value="ONSITE">Onsite</option>
                    <option value="ONLINE">Online</option>
                  </select>
                </div>
                {form.format === "ONLINE"
                  ? field("joinUrl", "Meeting link", true, false, "url")
                  : field("location", "Location (optional)")}
              </div>
              {form.format === "ONSITE" && (
                <p className={styles.help}>
                  Leave blank if the location is not yet known.
                </p>
              )}
            </section>
            <section className={styles.group} aria-labelledby="team-title">
              <h2 id="team-title">Interview team &amp; preparation</h2>
              <p className={styles.help}>
                Interviewers and preparation details.
              </p>
              <TeamPicker
                picker={form.picker}
                error={errors.attendeeMemberIds}
              />
              {field("preparationNotes", "Preparation Notes", false, true)}
              <p className={styles.help}>
                Preparation details are separate from Interview Notes on the
                meeting details page.
              </p>
            </section>
            {form.format === "ONSITE" ? (
              <p className={styles.help}>
                Meeting details are saved in this app only. Google Calendar is
                not synced.
              </p>
            ) : (
              <p className={styles.help}>
                Paste a link to an existing meeting room. Details are saved in
                this app only. Meeting rooms and Google Calendar events are not
                created automatically.
              </p>
            )}
            <div className={styles.actions}>
              {!save.locked && <Link href="/dashboard">Cancel</Link>}
              <button
                className={styles.primary}
                type="submit"
                disabled={save.locked}
              >
                {save.phase === "saving" ? "Saving…" : "Save Meeting"}
              </button>
            </div>
          </form>
          <aside className={`${styles.panel} ${styles.aside}`}>
            <h3>Prepare for the interview</h3>
            <p>
              Check the candidate name, position, and time, along with the
              participants, before saving.
            </p>
            <p className={styles.help}>Save meeting details in this app.</p>
          </aside>
        </div>
      )}
    </main>
  );
}
