"use client";
import { useEffect, useRef, useState } from "react";
import {
  interviewContentApi,
  InterviewContentError,
  type InterviewNote,
  type NoteSave,
} from "@/api/interviewContent";
import { authController, type AuthSnapshot } from "./authController";
import { useAuth } from "./useAuth";

type Phase =
  | "loading"
  | "ready"
  | "error"
  | "saving"
  | "unknown"
  | "readback"
  | "readback-error"
  | "conflict"
  | "conflict-loading"
  | "conflict-error"
  | "denied";
type State = {
  meetingId: string;
  principal: string | null;
  phase: Phase;
  note: InterviewNote | null;
  draft: string;
  error: string | null;
  latest: InterviewNote | null;
  latestLoaded: boolean;
  saved: boolean;
};
const createInitialNotesState = (
  meetingId: string,
  principal: string | null,
): State => ({
  meetingId,
  principal,
  phase: "loading",
  note: null,
  draft: "",
  error: null,
  latest: null,
  latestLoaded: false,
  saved: false,
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
  change: (text: string) => void;
  save: () => Promise<void>;
  retry: () => Promise<void>;
  loadLatest: () => Promise<void>;
  resolve: (keepDraft: boolean) => void;
};

export function useInterviewNotes(
  meetingId: string,
  api: Pick<
    typeof interviewContentApi,
    "readNote" | "saveNote"
  > = interviewContentApi,
) {
  const auth = useAuth(),
    principal = getAuthenticatedIdentityKey(auth);
  const [state, setState] = useState<State>(() =>
    createInitialNotesState(meetingId, null),
  );
  const actions = useRef<Actions | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      readAbort: AbortController | null = null;
    let current = createInitialNotesState(meetingId, null);
    let operation: Readonly<NoteSave> | null = null;
    const updateNotesState = (next: State) => {
      current = next;
      if (active) {
        setState(next);
      }
    };
    const invalidateNoteRequest = () => {
      generation++;
      readAbort?.abort();
      readAbort = null;
    };
    const isCurrentNoteRequest = (ticket: number, owner: string) =>
      active &&
      generation === ticket &&
      getAuthenticatedIdentityKey(authController.getSnapshot()) === owner &&
      current.principal === owner;
    function applyNoteAccessDenial(error: unknown) {
      if (
        !(error instanceof InterviewContentError) ||
        ![401, 403, 404].includes(error.status ?? 0)
      ) {
        return false;
      }
      operation = null;
      updateNotesState({
        ...createInitialNotesState(meetingId, current.principal),
        phase: "denied",
        error: error.code,
      });
      if (error.status === 401 || error.status === 403) {
        void authController.refresh();
      }
      return true;
    }
    async function loadInterviewNote(
      mode: "initial" | "readback" | "conflict",
    ) {
      const owner = current.principal;
      if (
        !owner ||
        getAuthenticatedIdentityKey(authController.getSnapshot()) !== owner
      ) {
        return;
      }
      invalidateNoteRequest();
      const ticket = generation;
      readAbort = new AbortController();
      updateNotesState({
        ...current,
        phase:
          mode === "initial"
            ? "loading"
            : mode === "readback"
              ? "readback"
              : "conflict-loading",
        error: null,
      });
      try {
        const note = await api.readNote(meetingId, readAbort.signal);
        if (!isCurrentNoteRequest(ticket, owner)) {
          return;
        }
        if (mode === "readback" && note === null) {
          throw new InterviewContentError("INVALID_RESPONSE", 200);
        }
        if (mode === "conflict") {
          updateNotesState({
            ...current,
            phase: "conflict",
            latest: note,
            latestLoaded: true,
          });
        } else {
          operation = null;
          updateNotesState({
            ...current,
            phase: "ready",
            note,
            draft: note?.text ?? "",
            saved: mode === "readback",
            error: null,
          });
        }
      } catch (error) {
        if (
          !isCurrentNoteRequest(ticket, owner) ||
          applyNoteAccessDenial(error)
        ) {
          return;
        }
        updateNotesState({
          ...current,
          phase:
            mode === "initial"
              ? "error"
              : mode === "readback"
                ? "readback-error"
                : "conflict-error",
          error:
            error instanceof InterviewContentError
              ? error.code
              : "NETWORK_ERROR",
        });
      } finally {
        if (ticket === generation) {
          readAbort = null;
        }
      }
    }
    async function saveNoteAndReloadConfirmedValue() {
      const owner = current.principal,
        payload = operation;
      if (
        !owner ||
        !payload ||
        getAuthenticatedIdentityKey(authController.getSnapshot()) !== owner
      ) {
        return;
      }
      invalidateNoteRequest();
      const ticket = generation;
      updateNotesState({
        ...current,
        phase: "saving",
        error: null,
        saved: false,
      });
      try {
        await api.saveNote(meetingId, payload);
        if (!isCurrentNoteRequest(ticket, owner)) {
          return;
        }
        await loadInterviewNote("readback");
      } catch (error) {
        if (
          !isCurrentNoteRequest(ticket, owner) ||
          applyNoteAccessDenial(error)
        ) {
          return;
        }
        if (error instanceof InterviewContentError && error.status === 409) {
          operation = null;
          updateNotesState({
            ...current,
            phase: "conflict",
            latestLoaded: false,
            latest: null,
            error: error.code,
          });
        } else if (
          error instanceof InterviewContentError &&
          [400, 415].includes(error.status ?? 0)
        ) {
          operation = null;
          updateNotesState({ ...current, phase: "ready", error: error.code });
        } else {
          updateNotesState({
            ...current,
            phase: "unknown",
            error:
              error instanceof InterviewContentError
                ? error.code
                : "NETWORK_ERROR",
          });
        }
      }
    }
    function syncNotesWithIdentity() {
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
        invalidateNoteRequest();
        const interrupted: Partial<Record<Phase, Phase>> = {
          saving: "unknown",
          readback: "readback-error",
          loading: "error",
          "conflict-loading": "conflict-error",
        };
        updateNotesState({
          ...current,
          phase: interrupted[current.phase] ?? current.phase,
          error:
            current.phase === "loading" ? "READ_INTERRUPTED" : current.error,
        });
      } else if (!next) {
        invalidateNoteRequest();
        operation = null;
        updateNotesState(createInitialNotesState(meetingId, null));
      } else if (next !== current.principal) {
        invalidateNoteRequest();
        operation = null;
        updateNotesState(createInitialNotesState(meetingId, next));
        void loadInterviewNote("initial");
      } else if (
        current.phase === "error" &&
        current.error === "READ_INTERRUPTED"
      ) {
        void loadInterviewNote("initial");
      }
      // Same-account checks resume only an interrupted initial read, never loaded content or a draft.
    }
    actions.current = {
      change(text) {
        if (
          current.phase === "ready" &&
          getAuthenticatedIdentityKey(authController.getSnapshot()) ===
            current.principal
        ) {
          updateNotesState({
            ...current,
            draft: text,
            error: null,
            saved: false,
          });
        }
      },
      async save() {
        if (
          current.phase !== "ready" ||
          operation ||
          !current.principal ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !==
            current.principal
        ) {
          return;
        }
        operation = Object.freeze({
          text: current.draft,
          expectedUpdatedAt: current.note?.updatedAt ?? null,
        });
        await saveNoteAndReloadConfirmedValue();
      },
      async retry() {
        if (current.phase === "unknown") {
          await saveNoteAndReloadConfirmedValue();
        } else if (current.phase === "readback-error") {
          await loadInterviewNote("readback");
        } else if (current.phase === "error") {
          await loadInterviewNote("initial");
        } else if (current.phase === "conflict-error") {
          await loadInterviewNote("conflict");
        }
      },
      async loadLatest() {
        if (
          current.phase === "conflict" ||
          current.phase === "conflict-error"
        ) {
          await loadInterviewNote("conflict");
        }
      },
      resolve(keepDraft) {
        if (
          current.phase !== "conflict" ||
          !current.latestLoaded ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !==
            current.principal
        ) {
          return;
        }
        updateNotesState({
          ...current,
          phase: "ready",
          note: current.latest,
          draft: keepDraft ? current.draft : (current.latest?.text ?? ""),
          latest: null,
          latestLoaded: false,
          error: null,
        });
      },
    };
    const unsubscribe = authController.subscribe(syncNotesWithIdentity);
    queueMicrotask(syncNotesWithIdentity);
    return () => {
      active = false;
      invalidateNoteRequest();
      unsubscribe();
      actions.current = null;
    };
  }, [meetingId, api]);
  const visible =
    principal !== null &&
    state.principal === principal &&
    state.meetingId === meetingId;
  const view = visible ? state : createInitialNotesState(meetingId, null);
  return {
    ...view,
    visible,
    locked: !visible || view.phase !== "ready",
    change: (text: string) => actions.current?.change(text),
    save: () => actions.current?.save(),
    retry: () => actions.current?.retry(),
    loadLatest: () => actions.current?.loadLatest(),
    resolve: (keepDraft: boolean) => actions.current?.resolve(keepDraft),
  };
}
