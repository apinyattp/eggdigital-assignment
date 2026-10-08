"use client";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SaveToast } from "@/components/ui/SaveToast";
import type { useMeetingFeedback } from "@/hooks/useMeetingFeedback";
import styles from "../meeting-detail.module.css";
type FeedbackState = ReturnType<typeof useMeetingFeedback>;
const formatFeedbackUpdateTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
export const MeetingFeedback = memo(function MeetingFeedback({
  feedback,
  authorName,
}: {
  feedback: FeedbackState;
  authorName: string;
}) {
  const [dismissedSave, setDismissedSave] = useState<string | null>(null);
  const region = useRef<HTMLDivElement>(null),
    addButton = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const position = useRef<{ height: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = region.current;
    if (!element) {
      return;
    }
    if (feedback.revision === "older" && position.current) {
      element.scrollTop =
        position.current.top + element.scrollHeight - position.current.height;
    } else if (
      feedback.revision === "latest" ||
      feedback.revision === "own-create"
    ) {
      element.scrollTop = element.scrollHeight;
    }
    position.current = null;
  }, [feedback.items, feedback.revision]);
  useEffect(() => {
    if (feedback.saved) {
      region.current?.focus();
    }
  }, [feedback.saved]);
  function loadFeedbackPagePreservingScroll(retry = false) {
    if (region.current) {
      position.current = {
        height: region.current.scrollHeight,
        top: region.current.scrollTop,
      };
    }
    void (retry ? feedback.retryLoad() : feedback.older());
  }
  const own = feedback.items.find(
    (item) => item.id === feedback.ownFeedbackId && item.isOwn,
  );
  const busy =
    !!feedback.loading ||
    feedback.editor?.phase === "saving" ||
    feedback.editor?.phase === "unknown";
  function closeEditorAndRestoreFocus() {
    feedback.close();
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) {
        returnFocus.current.focus();
      } else {
        addButton.current?.focus();
      }
    });
  }
  return (
    <section
      className={`${styles.panel} ${styles.feedbackPanel} ${feedback.total === 0 && !feedback.items.length ? styles.compactFeedback : ""}`}
      aria-labelledby="feedback-heading"
    >
      <div className={styles.heading}>
        <h2 id="feedback-heading">History &amp; Evaluations</h2>
        <span className={styles.access}>Interview team only</span>
      </div>
      {(feedback.phase === "loading" || feedback.loading === "latest") && (
        <p role="status">Loading feedback…</p>
      )}
      {feedback.error && (
        <div role="alert" className={styles.feedbackReadError}>
          <p>
            {feedback.refreshRequired
              ? "The reference for loading older feedback is no longer valid. Loaded items are preserved. Select Refresh to load the latest feedback."
              : "Unable to load feedback. Existing items are preserved."}
          </p>
          {feedback.refreshRequired ? (
            <button
              type="button"
              disabled={busy || !!feedback.editor}
              onClick={() => {
                void feedback.refresh();
              }}
            >
              Refresh Feedback
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => loadFeedbackPagePreservingScroll(true)}
            >
              Retry loading feedback
            </button>
          )}
        </div>
      )}
      <div
        ref={region}
        className={styles.history}
        role="region"
        aria-labelledby="feedback-heading"
        tabIndex={0}
      >
        {feedback.page * 50 < feedback.total && (
          <div className={styles.older}>
            <button
              type="button"
              disabled={busy || feedback.refreshRequired}
              onClick={() => loadFeedbackPagePreservingScroll()}
            >
              Load older feedback
            </button>
          </div>
        )}
        {feedback.loading === "older" && (
          <p role="status">Loading older feedback…</p>
        )}
        <h3>
          Interview feedback{" "}
          <span className={styles.timezone}>· Bangkok (UTC+7)</span>
        </h3>
        {feedback.phase === "ready" && !feedback.items.length && (
          <p className={styles.help}>No feedback saved yet.</p>
        )}
        {feedback.items.map((item) => (
          <article
            className={`${styles.entry} ${item.isOwn ? styles.entryEditable : ""}`}
            key={item.id}
            data-feedback-id={item.id}
          >
            <div className={styles.entryBody}>
              <h4>
                <FeedbackTimestamp updatedAt={item.updatedAt} />
              </h4>
              <p className={styles.text}>{item.text}</p>
              <p className={styles.help}>
                By {item.author.displayName}
                {item.isOwn ? " · You" : ""}
              </p>
              {!item.isOwn && (
                <p className={styles.help}>
                  Read-only · written by another interviewer
                </p>
              )}
            </div>
            {item.isOwn && (
              <div className={styles.entryActions}>
                <button
                  className={styles.edit}
                  type="button"
                  aria-label="Edit Feedback"
                  title="Edit Feedback"
                  disabled={
                    busy || feedback.refreshRequired || !!feedback.editor
                  }
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    feedback.open(item.id);
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path d="m16 3 5 5-12 12-6 1 1-6L16 3Z M13 6l5 5" />
                  </svg>
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {feedback.saved && dismissedSave !== (own?.updatedAt ?? "") && (
        <SaveToast
          message="Feedback saved."
          onDismiss={() => setDismissedSave(own?.updatedAt ?? "")}
        />
      )}
      <div className={styles.feedbackFooter}>
        <button
          className={styles.addFeedback}
          ref={addButton}
          type="button"
          disabled={!feedback.canAdd}
          aria-describedby="feedback-add-help"
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            feedback.open();
          }}
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
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 3V11.5A7.5 7.5 0 0 1 10.5 4h2a7.5 7.5 0 0 1 7.5 7.5Z" />
            <path d="M8 10h7m-7 4h4" />
          </svg>
          Add Feedback
        </button>
        <p id="feedback-add-help" className={styles.help}>
          {feedback.ownFeedbackId
            ? own
              ? "You already have feedback for this meeting. You can edit your existing entry."
              : "You already have feedback for this meeting. Load older feedback to edit your entry."
            : feedback.phase === "error"
              ? "Unable to load feedback. Please try loading again."
              : feedback.phase === "loading" || busy
                ? "Feedback is loading or saving."
                : ""}
        </p>
      </div>
      {feedback.editor && feedback.visible && (
        <FeedbackEditor
          feedback={feedback}
          authorName={authorName}
          onClose={closeEditorAndRestoreFocus}
          onOlder={() => loadFeedbackPagePreservingScroll()}
        />
      )}
    </section>
  );
});
function FeedbackTimestamp({ updatedAt }: { updatedAt: string }) {
  const formatted = useMemo(
    () => formatFeedbackUpdateTime(updatedAt),
    [updatedAt],
  );
  return (
    <time
      dateTime={updatedAt}
      aria-label={`Latest update ${formatted} Bangkok UTC+7`}
    >
      {formatted}
    </time>
  );
}
function FeedbackEditor({
  feedback,
  authorName,
  onClose,
  onOlder,
}: {
  feedback: FeedbackState;
  authorName: string;
  onClose: () => void;
  onOlder: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  const editor = feedback.editor!;
  const locked = editor.phase !== "editing",
    busy = editor.phase === "saving" || editor.phase === "unknown";
  const own = feedback.items.find(
    (item) => item.id === feedback.ownFeedbackId && item.isOwn,
  );
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    input.current?.focus();
    return () => element.close();
  }, []);
  useEffect(() => {
    if (editor.error === "TEXT_REQUIRED") {
      input.current?.focus();
    }
  }, [editor.error]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="feedback-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void feedback.save();
        }}
      >
        <h2 id="feedback-editor-title">
          {editor.id ? "Edit Feedback" : "Add Feedback"}
        </h2>
        <p className={styles.help}>Author: {authorName} · You</p>
        <label htmlFor="feedback-text">Interview feedback</label>
        <textarea
          ref={input}
          id="feedback-text"
          value={editor.draft}
          readOnly={locked}
          aria-invalid={editor.error === "TEXT_REQUIRED" || undefined}
          aria-describedby="feedback-editor-error"
          onChange={(event) => feedback.change(event.target.value)}
        />
        <div id="feedback-editor-error" aria-live="polite">
          {editor.error === "TEXT_REQUIRED" && (
            <p className={styles.error}>Enter feedback before saving.</p>
          )}
          {editor.error &&
            editor.phase === "editing" &&
            editor.error !== "TEXT_REQUIRED" && (
              <p className={styles.error}>Unable to save. Your text is preserved.</p>
            )}
        </div>
        {editor.phase === "saving" && (
          <p role="status">Saving feedback…</p>
        )}
        {editor.phase === "unknown" && (
          <div role="alert" className={styles.notice}>
            <p>
              The save result is not yet confirmed. The same request and text will be used to check again.
            </p>
            <button
              type="button"
              onClick={() => {
                void feedback.retrySave();
              }}
            >
              Check original request again
            </button>
          </div>
        )}
        {editor.phase === "conflict" && (
          <div role="alert" className={styles.notice}>
            <p>
              Your saved feedback has changed. Your text is preserved.
              Load the latest feedback and choose which text to use before saving again.
            </p>
            <button
              type="button"
              disabled={!!feedback.loading}
              onClick={() => {
                void feedback.refresh();
              }}
            >
              Refresh feedback to review
            </button>
            {!feedback.refreshRequired && own && (
              <>
                <h3>Saved feedback</h3>
                <p className={styles.text}>{own.text}</p>
                <div className={styles.actions}>
                  <button type="button" onClick={() => feedback.resolve(false)}>
                    Use saved text
                  </button>
                  <button type="button" onClick={() => feedback.resolve(true)}>
                    Keep my text to save again
                  </button>
                </div>
              </>
            )}
            {!own &&
              feedback.page * 50 < feedback.total &&
              !feedback.refreshRequired && (
                <button
                  type="button"
                  disabled={!!feedback.loading}
                  onClick={onOlder}
                >
                  Load older feedback to find my entry
                </button>
              )}
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.primary}
            type="submit"
            disabled={locked || !!feedback.loading || feedback.refreshRequired}
            aria-busy={editor.phase === "saving"}
          >
            {editor.phase === "saving" && (
              <span className={styles.saveSpinner} aria-hidden="true" />
            )}
            {editor.phase === "saving" ? "Saving…" : "Save Feedback"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
