"use client";
import { WorkspaceLoading } from "@/app/(main)/_components/WorkspaceLoading";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMeetingEdit } from "@/hooks/useMeetingEdit";
import { authController } from "@/hooks/authController";
import { useCurrentIdentity } from "@/hooks/useAuth";
import { useMeetingSummary } from "@/hooks/useMeetingSummary";
import { useInterviewNotes } from "@/hooks/useInterviewNotes";
import { useMeetingFeedback } from "@/hooks/useMeetingFeedback";
import { useMeetingLifecycle } from "@/hooks/useMeetingLifecycle";
import { InterviewNotes } from "./InterviewNotes";
import { MeetingFeedback } from "./MeetingFeedback";
import { MeetingStatusActions } from "./MeetingStatusActions";
import {
  MeetingDeleteAction,
  MeetingLifecycleActions,
} from "./MeetingLifecycleActions";
import { avatarColors } from "@/components/ui/avatarColors";
import styles from "../meeting-detail.module.css";
const formatMeetingDateTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
export function MeetingDetail({
  meetingId,
  returnDate,
}: {
  meetingId: string;
  returnDate?: string;
}) {
  const auth = useCurrentIdentity(),
    session = auth.usableSession,
    summary = useMeetingSummary(meetingId),
    notes = useInterviewNotes(meetingId),
    feedback = useMeetingFeedback(meetingId);
  // Keep uncertain writes across temporary identity checks and Summary reloads.
  const lifecycle = useMeetingLifecycle(meetingId);
  // Keep status mutation/recovery alive through temporary identity and Summary checks.
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const canManageStatus =
    !!session &&
    !!summary.meeting &&
    session.user.id === summary.meeting.organizer.id &&
    summary.meeting.status !== "CANCELLED" &&
    Date.parse(summary.meeting.endsAt) > currentTime;
  const statusEdit = useMeetingEdit(meetingId, undefined, canManageStatus);
  const deliveredStatusVersion = useRef<string | null>(null);
  useEffect(() => {
    if (
      statusEdit.saved &&
      statusEdit.meeting &&
      deliveredStatusVersion.current !== statusEdit.meeting.updatedAt
    ) {
      deliveredStatusVersion.current = statusEdit.meeting.updatedAt;
      void summary.refresh();
    }
  }, [statusEdit.saved, statusEdit.meeting, summary]);

  const back = (
    <Link
      href={
        returnDate
          ? `/dashboard?date=${encodeURIComponent(returnDate)}`
          : "/dashboard"
      }
      className={styles.back}
    >
      ← All Meetings
    </Link>
  );
  if (!auth.checked || auth.status === "checking") {
    return (
      <main className={styles.shell}>
        <WorkspaceLoading message="Checking your account…" />
      </main>
    );
  }
  if (!session) {
    return (
      <main className={styles.shell}>
        <h1>Candidate profile</h1>
        <p role="alert">Unable to verify your access to this meeting.</p>
        <button
          type="button"
          onClick={() => {
            void authController.refresh();
          }}
        >
          Check account again
        </button>
        {back}
      </main>
    );
  }
  if (
    summary.phase === "denied" ||
    notes.phase === "denied" ||
    feedback.phase === "denied"
  ) {
    return (
      <main className={styles.shell}>
        <h1>Meeting not found or you do not have access.</h1>
        {back}
      </main>
    );
  }
  if (summary.phase === "loading") {
    return (
      <main className={styles.shell}>
        <WorkspaceLoading message="Loading meeting details…" />
        {back}
      </main>
    );
  }
  if (!summary.meeting) {
    return (
      <main className={styles.shell}>
        <h1>Unable to load meeting details.</h1>
        <button
          type="button"
          onClick={() => {
            void summary.refresh();
          }}
        >
          Retry loading meeting details
        </button>
        {back}
      </main>
    );
  }
  const meeting = summary.meeting;
  return (
    <main className={styles.shell}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>CANDIDATE SUMMARY</p>
          <h1>Candidate profile</h1>
        </div>
        {back}
      </header>
      <section className={styles.profile}>
        <div className={styles.profilePerson}>
          <span className={styles.profileAvatar} aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
            </svg>
          </span>
          <div>
            <h2>{meeting.candidate.name}</h2>
            <p>{meeting.position}</p>
          </div>
        </div>
        <div className={styles.profileStatus}>
          <div className={styles.statusReadback}>
            <span>Meeting status</span>
            <p className={styles.status}>
              {meeting.status.charAt(0) + meeting.status.slice(1).toLowerCase()}
            </p>
          </div>
          {canManageStatus && (
            <MeetingStatusActions
              edit={statusEdit}
              currentTime={currentTime}
              onChanged={() => {
                void summary.refresh();
              }}
            />
          )}
        </div>
      </section>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <h2>Meeting Info</h2>
            <dl className={styles.data}>
              <dt>Title</dt>
              <dd>{meeting.title}</dd>
              <dt>Start</dt>
              <dd>
                <time dateTime={meeting.startsAt}>
                  {formatMeetingDateTime(meeting.startsAt)}
                </time>{" "}
                · Bangkok (UTC+7)
              </dd>
              <dt>End</dt>
              <dd>
                <time dateTime={meeting.endsAt}>
                  {formatMeetingDateTime(meeting.endsAt)}
                </time>{" "}
                · Bangkok (UTC+7)
              </dd>
              <dt>Meeting type</dt>
              <dd>{meeting.format === "ONSITE" ? "Onsite" : "Online"}</dd>
              {meeting.format === "ONSITE" && (
                <>
                  <dt>Location</dt>
                  <dd>{meeting.location || "—"}</dd>
                </>
              )}
              <dt>Description</dt>
              <dd>{meeting.description || "—"}</dd>
            </dl>
            <div className={styles.preparation}>
              <h3>Preparation Notes</h3>
              <p className={styles.text}>{meeting.preparationNotes || "—"}</p>
            </div>
            <MeetingLifecycleActions
              joinUrl={
                meeting.format === "ONLINE" && meeting.status !== "CANCELLED"
                  ? meeting.joinUrl
                  : null
              }
              meetingId={meetingId}
              creatorId={meeting.organizer.id}
              status={meeting.status}
              returnDate={returnDate}
              lifecycle={lifecycle}
              onMeetingChanged={() => {
                void summary.refresh();
              }}
              onUnavailable={() => {
                void summary.refresh();
              }}
            />
          </section>
          <InterviewNotes notes={notes} authorName={session.user.displayName} />
        </div>
        <div className={`${styles.stack} ${styles.secondary}`}>
          <section className={`${styles.panel} ${styles.participants}`}>
            <h2>Meeting participants</h2>
            <p className={styles.help}>
              {meeting.attendeeCount} attendees · excluding the organizer
            </p>
            <ul className={styles.members}>
              {meeting.attendees.map((member) => (
                <li key={member.email}>
                  <span
                    className={styles.avatar}
                    style={avatarColors(member.email, member.memberId)}
                    aria-hidden="true"
                  >
                    {Array.from(member.displayName)[0]}
                  </span>
                  <div>
                    <strong>{member.displayName}</strong>
                    <span className={styles.help}>{member.email}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.help}>
              Organizer: {meeting.organizer.displayName}
            </p>
          </section>
          <MeetingFeedback
            feedback={feedback}
            authorName={session.user.displayName}
          />
        </div>
      </div>
      <MeetingDeleteAction
        lifecycle={lifecycle}
        creatorId={meeting.organizer.id}
      />
    </main>
  );
}
