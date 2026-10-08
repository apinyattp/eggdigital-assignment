"use client";
import { useState } from "react";
import { SaveToast } from "@/components/ui/SaveToast";
import type { useInterviewNotes } from "@/hooks/useInterviewNotes";
import styles from "../meeting-detail.module.css";
type Notes = ReturnType<typeof useInterviewNotes>;
export function InterviewNotes({
  notes,
  authorName,
}: {
  notes: Notes;
  authorName: string;
}) {
  const [dismissedSave, setDismissedSave] = useState<string | null>(null);
  const savedVersion = notes.note?.updatedAt ?? "";
  const conflict = ["conflict", "conflict-loading", "conflict-error"].includes(
    notes.phase,
  );
  return (
    <section
      className={`${styles.panel} ${styles.notesPanel}`}
      aria-labelledby="notes-heading"
    >
      <div className={styles.heading}>
        <h2 id="notes-heading">Interview Notes</h2>
      </div>
      {notes.phase === "loading" && <p role="status">Loading your notes…</p>}
      {notes.phase === "error" && (
        <div role="alert">
          <p>Unable to load notes.</p>
          <button
            type="button"
            onClick={() => {
              void notes.retry();
            }}
          >
            Retry loading notes
          </button>
        </div>
      )}
      {notes.phase === "denied" && (
        <p role="alert">Unable to access notes for this meeting.</p>
      )}
      {notes.visible &&
        !["loading", "error", "denied"].includes(notes.phase) && (
          <>
            <label htmlFor="interview-notes">Interview notes</label>
            <p className={styles.help}>Author: {authorName} · You</p>
            <textarea
              id="interview-notes"
              value={notes.draft}
              readOnly={notes.locked}
              onChange={(event) => notes.change(event.target.value)}
              placeholder="Write down questions or observations"
            />
            <div className={styles.actions}>
              <button
                type="button"
                disabled={notes.locked}
                aria-busy={
                  notes.phase === "saving" || notes.phase === "readback"
                }
                onClick={() => {
                  void notes.save();
                }}
              >
                {notes.phase === "saving" && (
                  <span className={styles.saveSpinner} aria-hidden="true" />
                )}
                {notes.phase === "saving"
                  ? "Saving Note…"
                  : notes.note
                    ? "Save Note"
                    : "Add Note"}
              </button>
            </div>
          </>
        )}
      {notes.saved && dismissedSave !== savedVersion && (
        <SaveToast
          message="Notes saved."
          onDismiss={() => setDismissedSave(savedVersion)}
        />
      )}
      {notes.phase === "readback" && (
        <p role="status">Saved. Loading the saved notes…</p>
      )}
      {notes.phase === "unknown" && (
        <div className={styles.notice} role="alert">
          <p>The save result is not yet confirmed. Your text is preserved.</p>
          <button
            type="button"
            onClick={() => {
              void notes.retry();
            }}
          >
            Check original request again
          </button>
        </div>
      )}
      {notes.phase === "readback-error" && (
        <div className={styles.notice} role="alert">
          <p>Notes were saved, but the saved notes could not be loaded.</p>
          <button
            type="button"
            onClick={() => {
              void notes.retry();
            }}
          >
            Reload saved notes
          </button>
        </div>
      )}
      {notes.error && notes.phase === "ready" && (
        <p role="alert" className={styles.error}>
          Unable to save. Check the text and try again.
        </p>
      )}
      {conflict && (
        <div className={styles.notice} role="alert">
          <p>
            The notes were changed elsewhere. Your text is preserved.
            Review the latest details before saving again.
          </p>
          {notes.phase === "conflict-loading" ? (
            <p role="status">Loading the latest value…</p>
          ) : !notes.latestLoaded ? (
            <button
              type="button"
              onClick={() => {
                void notes.loadLatest();
              }}
            >
              Load latest notes to review
            </button>
          ) : (
            <>
              <h3>Saved notes</h3>
              <p className={styles.text}>
                {notes.latest?.text || "No saved text yet."}
              </p>
              <div className={styles.actions}>
                <button type="button" onClick={() => notes.resolve(false)}>
                  Use saved text
                </button>
                <button type="button" onClick={() => notes.resolve(true)}>
                  Keep my text to save again
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
