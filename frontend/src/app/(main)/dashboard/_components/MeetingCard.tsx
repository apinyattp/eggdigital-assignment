"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MeetingSummary } from "@/api/meetingSummary";
import { avatarColors } from "@/components/ui/avatarColors";
import styles from "../dashboard.module.css";
const formatBangkokMeetingTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
const formatBangkokMeetingDate = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function MeetingCard({
  meeting,
  date,
}: {
  meeting: MeetingSummary;
  date: string;
}) {
  const [expanded, setExpanded] = useState(false),
    [attendeesOpen, setAttendeesOpen] = useState(false);
  const attendeeTrigger = useRef<HTMLButtonElement>(null);
  const expandedPanel = useRef<HTMLDivElement>(null);
  const previousExpanded = useRef(expanded);
  useLayoutEffect(() => {
    const changed = previousExpanded.current !== expanded;
    previousExpanded.current = expanded;
    const panel = expandedPanel.current;
    if (
      !changed ||
      !panel ||
      typeof panel.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    panel.hidden = false;
    const height = panel.getBoundingClientRect().height;
    panel.style.overflow = "hidden";
    const animation = panel.animate(
      [
        { height: `${expanded ? 0 : height}px`, opacity: expanded ? 0 : 1 },
        { height: `${expanded ? height : 0}px`, opacity: expanded ? 1 : 0 },
      ],
      { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" },
    );
    void animation.finished
      .then(() => {
        panel.hidden = !expanded;
        panel.style.overflow = "";
      })
      .catch(() => {});
    return () => {
      animation.cancel();
      panel.style.overflow = "";
    };
  }, [expanded]);
  const attendees = (
    <button
      ref={attendeeTrigger}
      type="button"
      className={styles.attendees}
      aria-haspopup="dialog"
      aria-label={`View all ${meeting.attendeeCount} attendees for ${meeting.candidate.name}`}
      onClick={() => setAttendeesOpen(true)}
    >
      <span className={styles.attendeeCount}>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v1" />
        </svg>
        <span>
          {meeting.attendeeCount} attendee
          {meeting.attendeeCount === 1 ? "" : "s"}
        </span>
      </span>
      {meeting.attendees.length > 0 && (
        <span className={styles.avatars} aria-hidden="true">
          {meeting.attendees.slice(0, 3).map((person) => (
            <span
              key={person.email}
              style={avatarColors(person.email, person.memberId)}
            >
              {Array.from(person.displayName)[0]}
            </span>
          ))}
          {meeting.attendeeCount > 3 && (
            <span>+{meeting.attendeeCount - 3}</span>
          )}
        </span>
      )}
    </button>
  );
  return (
    <div className={styles.timeline}>
      <div className={styles.time}>
        <strong>{formatBangkokMeetingTime(meeting.startsAt)}</strong>
        <span>{formatBangkokMeetingTime(meeting.endsAt)}</span>
        {formatBangkokMeetingDate(meeting.startsAt) !==
          formatBangkokMeetingDate(meeting.endsAt) && (
          <small>{formatBangkokMeetingDate(meeting.endsAt)}</small>
        )}
      </div>
      <article
        className={styles.card}
        data-meeting-id={meeting.id}
        data-format={meeting.format}
      >
        <button
          type="button"
          className={styles.cardToggle}
          aria-expanded={expanded}
          aria-controls={`meeting-${meeting.id}`}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${meeting.candidate.name} meeting summary`}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>
            <strong>{meeting.candidate.name}</strong>
            <span className={styles.cardRole}>{meeting.position}</span>
          </span>
          <span aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d={expanded ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
            </svg>
          </span>
        </button>
        <div className={styles.overview}>
          <div className={styles.facts}>
            <div>
              <span className={styles.factLabel}>Format</span>
              <span className={styles.cardChannel}>
                {meeting.location ||
                  (meeting.format === "ONSITE"
                    ? "Location not specified"
                    : "Online meeting")}{" "}
                · {meeting.format === "ONSITE" ? "Onsite" : "Online"}
              </span>
            </div>
            <div>
              <span className={styles.factLabel}>Meeting status</span>
              <span data-status={meeting.status}>
                {meeting.status.charAt(0) +
                  meeting.status.slice(1).toLowerCase()}
              </span>
            </div>
          </div>
          {!expanded && attendees}
          <Link
            className={styles.view}
            href={`/meetings/${encodeURIComponent(meeting.id)}?date=${encodeURIComponent(date)}`}
            aria-label={`View ${meeting.candidate.name} meeting`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View
          </Link>
        </div>
        <div
          id={`meeting-${meeting.id}`}
          ref={expandedPanel}
          hidden={!expanded}
          className={styles.expanded}
        >
          <h3>{meeting.title}</h3>
          <dl>
            <dt>Time</dt>
            <dd>
              {formatBangkokMeetingTime(meeting.startsAt)}–
              {formatBangkokMeetingTime(meeting.endsAt)}
              {formatBangkokMeetingDate(meeting.startsAt) !==
              formatBangkokMeetingDate(meeting.endsAt)
                ? ` · ends ${formatBangkokMeetingDate(meeting.endsAt)}`
                : ""}{" "}
              · Bangkok (UTC+7)
            </dd>
            <dt>Attendees</dt>
            <dd>{expanded && attendees}</dd>
            <dt>Location</dt>
            <dd>{meeting.location || "—"}</dd>
            <dt>Organizer</dt>
            <dd>{meeting.organizer.displayName}</dd>
          </dl>
          {meeting.format === "ONLINE" &&
            meeting.status !== "CANCELLED" &&
            meeting.joinUrl && (
              <a
                className={styles.join}
                href={meeting.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 10l6-3v10l-6-3M5 6h7a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" />
                </svg>
                Join Meeting
              </a>
            )}
        </div>
        {attendeesOpen && (
          <Attendees
            meeting={meeting}
            onClose={() => {
              setAttendeesOpen(false);
              requestAnimationFrame(() => attendeeTrigger.current?.focus());
            }}
          />
        )}
      </article>
    </div>
  );
}
function Attendees({
  meeting,
  onClose,
}: {
  meeting: MeetingSummary;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${styles.attendeeDialog}`}
      aria-labelledby={`attendee-title-${meeting.id}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.attendeeHeading}>
        <div>
          <h2 id={`attendee-title-${meeting.id}`}>Attendees</h2>
          <p className={styles.help}>
            {meeting.attendeeCount}{" "}
            {meeting.attendeeCount === 1 ? "person" : "people"} ·{" "}
            {meeting.candidate.name}
          </p>
        </div>
        <button
          type="button"
          className={styles.attendeeClose}
          aria-label="Close attendee list"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <ul
        className={styles.attendeeList}
        tabIndex={0}
        aria-label="All attendee names"
      >
        {meeting.attendees.map((person) => (
          <li key={person.email}>
            <span
              className={styles.attendeeAvatar}
              aria-hidden="true"
              style={avatarColors(person.email, person.memberId)}
            >
              {Array.from(person.displayName)[0]}
            </span>
            <span>
              <strong>{person.displayName}</strong>
              <small>{person.email}</small>
            </span>
          </li>
        ))}
        {meeting.attendees.length === 0 && (
          <li className={styles.help}>No additional attendees yet.</li>
        )}
      </ul>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}
