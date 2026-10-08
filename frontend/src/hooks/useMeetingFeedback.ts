"use client";
import { useEffect, useRef, useState } from "react";
import {
  interviewContentApi,
  InterviewContentError,
  type Feedback,
  type FeedbackCreate,
  type FeedbackEdit,
} from "@/api/interviewContent";
import { authController, type AuthSnapshot } from "./authController";
import { useAuth } from "./useAuth";

type Editor = {
  id: string | null;
  draft: string;
  expectedUpdatedAt: string | null;
  phase: "editing" | "saving" | "unknown" | "conflict";
  error: string | null;
};
type State = {
  meetingId: string;
  principal: string | null;
  phase: "loading" | "ready" | "error" | "denied";
  items: Feedback[];
  ownFeedbackId: string | null;
  page: number;
  total: number;
  asOf: string | null;
  snapshot: string | null;
  loading: "latest" | "older" | null;
  failedPage: number;
  error: string | null;
  refreshRequired: boolean;
  editor: Editor | null;
  saved: boolean;
  revision: "latest" | "older" | "own-create" | "own-edit" | null;
};
type Operation =
  | { kind: "create"; payload: Readonly<FeedbackCreate> }
  | { kind: "edit"; id: string; payload: Readonly<FeedbackEdit> };
const createInitialFeedbackState = (
  meetingId: string,
  principal: string | null,
): State => ({
  meetingId,
  principal,
  phase: "loading",
  items: [],
  ownFeedbackId: null,
  page: 0,
  total: 0,
  asOf: null,
  snapshot: null,
  loading: null,
  failedPage: 1,
  error: null,
  refreshRequired: false,
  editor: null,
  saved: false,
  revision: null,
});
function getAuthenticatedIdentityKey(auth: AuthSnapshot) {
  return auth.status === "authenticated" &&
    auth.session &&
    !auth.pending &&
    !auth.logoutRequired
    ? `${auth.session.user.membership}:${auth.session.user.id ?? auth.session.user.email}`
    : null;
}
type Actions = {
  refresh: () => Promise<void>;
  older: () => Promise<void>;
  retryLoad: () => Promise<void>;
  open: (id?: string) => void;
  close: () => void;
  change: (text: string) => void;
  save: () => Promise<void>;
  retrySave: () => Promise<void>;
  resolve: (keepDraft: boolean) => void;
};

export function useMeetingFeedback(
  meetingId: string,
  api: Pick<
    typeof interviewContentApi,
    "readFeedback" | "createFeedback" | "editFeedback"
  > = interviewContentApi,
) {
  const auth = useAuth(),
    principal = getAuthenticatedIdentityKey(auth);
  const [state, setState] = useState<State>(() =>
    createInitialFeedbackState(meetingId, null),
  );
  const actions = useRef<Actions | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      readAbort: AbortController | null = null;
    let current = createInitialFeedbackState(meetingId, null),
      operation: Operation | null = null;
    const updateFeedbackState = (next: State) => {
      current = next;
      if (active) {
        setState(next);
      }
    };
    const invalidateFeedbackRequest = () => {
      generation++;
      readAbort?.abort();
      readAbort = null;
    };
    const isCurrentFeedbackRequest = (ticket: number, owner: string) =>
      active &&
      generation === ticket &&
      getAuthenticatedIdentityKey(authController.getSnapshot()) === owner &&
      current.principal === owner;
    function applyFeedbackAccessDenial(error: unknown) {
      if (
        !(error instanceof InterviewContentError) ||
        ![401, 403, 404].includes(error.status ?? 0)
      ) {
        return false;
      }
      operation = null;
      updateFeedbackState({
        ...createInitialFeedbackState(meetingId, current.principal),
        phase: "denied",
        error: error.code,
      });
      if (error.status === 401 || error.status === 403) {
        void authController.refresh();
      }
      return true;
    }
    async function loadFeedbackPage(pageNumber = 1) {
      const owner = current.principal;
      if (
        !owner ||
        getAuthenticatedIdentityKey(authController.getSnapshot()) !== owner ||
        current.loading ||
        current.editor?.phase === "saving" ||
        current.editor?.phase === "unknown"
      ) {
        return;
      }
      invalidateFeedbackRequest();
      const ticket = generation;
      readAbort = new AbortController();
      updateFeedbackState({
        ...current,
        loading: pageNumber === 1 ? "latest" : "older",
        error: null,
        failedPage: pageNumber,
        saved: false,
      });
      try {
        const page = await api.readFeedback(
          meetingId,
          pageNumber,
          pageNumber > 1 ? (current.snapshot ?? undefined) : undefined,
          readAbort.signal,
        );
        if (!isCurrentFeedbackRequest(ticket, owner)) {
          return;
        }
        if (
          pageNumber > 1 &&
          (page.snapshot !== current.snapshot ||
            page.asOf !== current.asOf ||
            page.total !== current.total)
        ) {
          throw new InterviewContentError("LIST_CHANGED", 409);
        }
        // Older batches do not replace newer/own DTOs already on screen.
        const existing = new Set(current.items.map((item) => item.id));
        const older = page.items.filter(
          (item, index, items) =>
            !existing.has(item.id) &&
            items.findIndex((other) => other.id === item.id) === index,
        );
        updateFeedbackState({
          ...current,
          phase: "ready",
          items: pageNumber === 1 ? page.items : [...older, ...current.items],
          ownFeedbackId: page.ownFeedbackId,
          page: page.page,
          total: page.total,
          asOf: page.asOf,
          snapshot: page.snapshot,
          loading: null,
          error: null,
          refreshRequired: false,
          revision: pageNumber === 1 ? "latest" : "older",
        });
      } catch (error) {
        if (
          !isCurrentFeedbackRequest(ticket, owner) ||
          applyFeedbackAccessDenial(error)
        ) {
          return;
        }
        updateFeedbackState({
          ...current,
          phase: current.phase === "loading" ? "error" : current.phase,
          loading: null,
          error:
            error instanceof InterviewContentError
              ? error.code
              : "NETWORK_ERROR",
          refreshRequired:
            current.refreshRequired ||
            (error instanceof InterviewContentError &&
              (error.code === "INVALID_CURSOR" ||
                error.code === "LIST_CHANGED")),
        });
      } finally {
        if (ticket === generation) {
          readAbort = null;
        }
      }
    }
    async function savePendingFeedbackOperation() {
      const owner = current.principal,
        op = operation;
      if (
        !owner ||
        !op ||
        !current.editor ||
        current.loading ||
        getAuthenticatedIdentityKey(authController.getSnapshot()) !== owner
      ) {
        return;
      }
      invalidateFeedbackRequest();
      const ticket = generation;
      updateFeedbackState({
        ...current,
        saved: false,
        editor: { ...current.editor, phase: "saving", error: null },
      });
      try {
        const result =
          op.kind === "create"
            ? (await api.createFeedback(meetingId, op.payload)).feedback
            : await api.editFeedback(meetingId, op.id, op.payload);
        if (!isCurrentFeedbackRequest(ticket, owner)) {
          return;
        }
        if (!result.isOwn || (op.kind === "edit" && result.id !== op.id)) {
          throw new InterviewContentError(
            "INVALID_RESPONSE",
            op.kind === "create" ? 201 : 200,
          );
        }
        operation = null;
        const found = current.items.some((item) => item.id === result.id);
        // Own mutation acknowledgement updates only this row. No latest GET,
        // sorting by updatedAt or automatic import of other authors' new rows.
        updateFeedbackState({
          ...current,
          items: found
            ? current.items.map((item) =>
                item.id === result.id ? result : item,
              )
            : [...current.items, result],
          ownFeedbackId: result.id,
          editor: null,
          saved: true,
          revision: op.kind === "create" ? "own-create" : "own-edit",
        });
      } catch (error) {
        if (
          !isCurrentFeedbackRequest(ticket, owner) ||
          applyFeedbackAccessDenial(error) ||
          !current.editor
        ) {
          return;
        }
        const code =
          error instanceof InterviewContentError ? error.code : "NETWORK_ERROR";
        if (error instanceof InterviewContentError && error.status === 409) {
          operation = null;
          updateFeedbackState({
            ...current,
            refreshRequired: true,
            editor: { ...current.editor, phase: "conflict", error: code },
          });
        } else if (
          error instanceof InterviewContentError &&
          [400, 415].includes(error.status ?? 0)
        ) {
          operation = null;
          updateFeedbackState({
            ...current,
            editor: { ...current.editor, phase: "editing", error: code },
          });
        } else {
          updateFeedbackState({
            ...current,
            editor: { ...current.editor, phase: "unknown", error: code },
          });
        }
      }
    }
    function syncFeedbackWithIdentity() {
      if (!active) {
        return;
      }
      const snapshot = authController.getSnapshot(),
        next = getAuthenticatedIdentityKey(snapshot);
      if (
        snapshot.status === "checking" ||
        (snapshot.status === "error" &&
          !snapshot.logoutRequired &&
          !snapshot.pending)
      ) {
        invalidateFeedbackRequest();
        updateFeedbackState({
          ...current,
          phase: current.phase === "loading" ? "error" : current.phase,
          loading: null,
          error: current.loading ? "READ_INTERRUPTED" : current.error,
          editor:
            current.editor?.phase === "saving"
              ? { ...current.editor, phase: "unknown" }
              : current.editor,
        });
      } else if (!next) {
        invalidateFeedbackRequest();
        operation = null;
        updateFeedbackState(createInitialFeedbackState(meetingId, null));
      } else if (next !== current.principal) {
        invalidateFeedbackRequest();
        operation = null;
        updateFeedbackState(createInitialFeedbackState(meetingId, next));
        void loadFeedbackPage();
      } else if (current.page === 0 && current.error === "READ_INTERRUPTED") {
        // Finish the first load cancelled by an identity check. Never refresh
        // a list that was already loaded for this member automatically.
        updateFeedbackState({ ...current, phase: "loading", error: null });
        void loadFeedbackPage();
      }
      // Returning focus with the same identity does not fetch latest Feedback.
    }
    actions.current = {
      async refresh() {
        if (current.editor?.phase !== "editing") {
          await loadFeedbackPage();
        }
      },
      async older() {
        if (current.page * 50 < current.total && !current.refreshRequired) {
          await loadFeedbackPage(current.page + 1);
        }
      },
      async retryLoad() {
        if (!current.refreshRequired) {
          await loadFeedbackPage(current.failedPage);
        }
      },
      open(id) {
        if (
          current.phase !== "ready" ||
          current.loading ||
          current.refreshRequired ||
          current.editor ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !==
            current.principal
        ) {
          return;
        }
        const item = id
          ? current.items.find((row) => row.id === id && row.isOwn)
          : null;
        if (id ? !item : current.ownFeedbackId !== null) {
          return;
        }
        updateFeedbackState({
          ...current,
          saved: false,
          editor: {
            id: item?.id ?? null,
            draft: item?.text ?? "",
            expectedUpdatedAt: item?.updatedAt ?? null,
            phase: "editing",
            error: null,
          },
        });
      },
      close() {
        if (
          current.editor &&
          !["saving", "unknown"].includes(current.editor.phase)
        ) {
          operation = null;
          updateFeedbackState({ ...current, editor: null });
        }
      },
      change(text) {
        if (
          current.editor?.phase === "editing" &&
          getAuthenticatedIdentityKey(authController.getSnapshot()) ===
            current.principal
        ) {
          updateFeedbackState({
            ...current,
            editor: { ...current.editor, draft: text, error: null },
          });
        }
      },
      async save() {
        const editor = current.editor;
        if (
          !editor ||
          editor.phase !== "editing" ||
          operation ||
          current.loading ||
          current.refreshRequired ||
          !current.principal ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !==
            current.principal
        ) {
          return;
        }
        const text = editor.draft.trim();
        if (!text) {
          updateFeedbackState({
            ...current,
            editor: { ...editor, error: "TEXT_REQUIRED" },
          });
          return;
        }
        if (editor.id) {
          if (
            !editor.expectedUpdatedAt ||
            !current.items.some((item) => item.id === editor.id && item.isOwn)
          ) {
            return;
          }
          operation = {
            kind: "edit",
            id: editor.id,
            payload: Object.freeze({
              text,
              expectedUpdatedAt: editor.expectedUpdatedAt,
            }),
          };
        } else {
          if (current.ownFeedbackId !== null) {
            return;
          }
          operation = {
            kind: "create",
            payload: Object.freeze({ text, requestId: crypto.randomUUID() }),
          };
        }
        await savePendingFeedbackOperation();
      },
      async retrySave() {
        if (current.editor?.phase === "unknown") {
          await savePendingFeedbackOperation();
        }
      },
      resolve(keepDraft) {
        if (
          current.editor?.phase !== "conflict" ||
          current.refreshRequired ||
          current.loading ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !==
            current.principal
        ) {
          return;
        }
        const own = current.items.find(
          (item) => item.id === current.ownFeedbackId && item.isOwn,
        );
        if (!own) {
          return;
        }
        updateFeedbackState({
          ...current,
          editor: {
            id: own.id,
            expectedUpdatedAt: own.updatedAt,
            draft: keepDraft ? current.editor.draft : own.text,
            phase: "editing",
            error: null,
          },
        });
      },
    };
    const unsubscribe = authController.subscribe(syncFeedbackWithIdentity);
    queueMicrotask(syncFeedbackWithIdentity);
    return () => {
      active = false;
      invalidateFeedbackRequest();
      unsubscribe();
      actions.current = null;
    };
  }, [meetingId, api]);
  const visible =
    principal !== null &&
    state.principal === principal &&
    state.meetingId === meetingId;
  const view = visible ? state : createInitialFeedbackState(meetingId, null);
  return {
    ...view,
    visible,
    canAdd:
      visible &&
      view.phase === "ready" &&
      !view.loading &&
      !view.refreshRequired &&
      !view.editor &&
      view.ownFeedbackId === null,
    refresh: () => actions.current?.refresh(),
    older: () => actions.current?.older(),
    retryLoad: () => actions.current?.retryLoad(),
    open: (id?: string) => actions.current?.open(id),
    close: () => actions.current?.close(),
    change: (text: string) => actions.current?.change(text),
    save: () => actions.current?.save(),
    retrySave: () => actions.current?.retrySave(),
    resolve: (keepDraft: boolean) => actions.current?.resolve(keepDraft),
  };
}
