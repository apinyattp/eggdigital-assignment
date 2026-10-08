"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@/api/auth/authApi";
import type { MeetingError } from "@/api/meetings";
import { useMeetingList } from "@/hooks/useMeetingList";
import { DateNavigation } from "./DateNavigation";
import { MeetingCard } from "./MeetingCard";
import { dateLabel, monday, todayBangkok, validDate } from "./dates";
import styles from "../dashboard.module.css";

export function MeetingDashboard({
  user,
  initialDate,
  onAccessError,
}: {
  user: Session["user"];
  initialDate?: string;
  onAccessError: (error: MeetingError) => void;
}) {
  const [date, setDate] = useState(() => {
    const currentDate =
      typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("date")
        : null;
    return validDate(currentDate)
      ? currentDate
      : validDate(initialDate)
        ? initialDate
        : todayBangkok();
  });
  const [week, setWeek] = useState(() => monday(date));
  const principal = `${user.membership}:${user.id ?? user.email}`;
  const list = useMeetingList(date, principal);
  useEffect(() => {
    if (list.accessError) onAccessError(list.accessError);
  }, [list.accessError, onAccessError]);
  function chooseDate(next: string) {
    setDate(next);
    setWeek(monday(next));
    const url = new URL(window.location.href);
    url.searchParams.set("date", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }
  const groups = list.data?.groups;
  const total = groups
    ? groups.upcomingCurrent.total +
      groups.rejectedCancelled.count +
      groups.past.count
    : null;
  return (
    <section aria-labelledby="meetings-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>YOUR INTERVIEW WORKSPACE</p>
          <h1 id="meetings-title">Meetings</h1>
          <p className={styles.help}>
            Prepare for interviews and revisit your notes in one place.
          </p>
        </div>
        {
          <Link className={styles.primary} href="/meetings/new">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add New Meeting
          </Link>
        }
      </div>
      <DateNavigation
        value={date}
        week={week}
        onChange={chooseDate}
        onWeekChange={setWeek}
      />
      {list.phase === "loading" && (
        <div className={styles.panel} role="status">
          Loading interviews…
          <div className={styles.skeleton} aria-hidden="true" />
          <div className={styles.skeleton} aria-hidden="true" />
        </div>
      )}
      {list.phase === "error" && (
        <div className={styles.panel} role="alert">
          <h2>Unable to load meetings</h2>
          <p>The selected date and existing data are preserved. Try loading again.</p>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              void list.refresh();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {list.phase === "denied" && (
        <div className={styles.panel} role="alert">
          <h2>Unable to verify your access to these meetings.</h2>
          <Link href="/login">Back to login</Link>
        </div>
      )}
      {list.phase === "ready" &&
        groups &&
        (total === 0 ? (
          <section
            className={styles.empty}
            aria-labelledby="dashboard-empty-title"
          >
            <span className={styles.emptyCalendar} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="16" rx="3" />
                <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2" />
              </svg>
            </span>
            <h2 id="dashboard-empty-title">No interviews yet</h2>
            <p>No meetings are available for the selected date.</p>
            <p className={styles.help}>Choose another date to view meetings.</p>
          </section>
        ) : (
          (Object.keys(groups) as (keyof typeof groups)[]).map((key) => {
            const group = groups[key],
              title =
                key === "upcomingCurrent"
                  ? "Upcoming / Current"
                  : key === "rejectedCancelled"
                    ? "Cancelled / Rejected"
                    : "Past Meetings";
            const count = "total" in group ? group.total : group.count;
            return (
              <section
                className={styles.meetingSection}
                key={key}
                data-section={key}
                aria-labelledby={`section-${key}`}
              >
                <div className={styles.heading}>
                  <h2 id={`section-${key}`}>{title}</h2>
                  <span className={styles.count}>
                    {count} {count === 1 ? "meeting" : "meetings"}
                  </span>
                </div>
                {count > 0 ? (
                  <>
                    {key !== "upcomingCurrent" && (
                      <p className={styles.help}>
                        Latest {group.items.length} of {count} ·{" "}
                        {dateLabel(date)}
                      </p>
                    )}
                    {group.items.map((meeting) => (
                      <MeetingCard
                        key={meeting.id}
                        meeting={meeting}
                        date={date}
                      />
                    ))}
                  </>
                ) : (
                  <div className={styles.sectionEmpty}>
                    <strong>
                      {key === "upcomingCurrent"
                        ? "No upcoming or current meetings"
                        : key === "rejectedCancelled"
                          ? "No cancelled or rejected meetings"
                          : "No past meetings"}
                    </strong>
                    <p>
                      No meetings in this section for{" "}
                      {new Date(`${date}T12:00:00Z`).toLocaleDateString(
                        "en-GB",
                        {
                          timeZone: "UTC",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        },
                      )}
                    </p>
                  </div>
                )}
                {key === "upcomingCurrent" &&
                  groups.upcomingCurrent.page *
                    groups.upcomingCurrent.pageSize <
                    groups.upcomingCurrent.total && (
                    <div className={styles.loadMore}>
                      {list.moreError && (
                        <p role="alert">
                          Unable to load more meetings. Existing results are preserved.
                          You can try again.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={list.morePending}
                        onClick={() => {
                          void list.loadMore();
                        }}
                      >
                        {list.morePending
                          ? "Loading more…"
                          : list.moreError
                            ? "Retry load more"
                            : "Load more"}
                      </button>
                    </div>
                  )}
              </section>
            );
          })
        ))}
    </section>
  );
}
