"use client";
import { useEffect, useRef, useState } from "react";
import {
  meetingsApi,
  MeetingError,
  type Meeting,
} from "@/api/meetings";
import { AuthError } from "@/api/auth/authError";
import { authController, type AuthSnapshot } from "./authController";
import { useAuth } from "./useAuth";
export type LifecycleAction = "cancel" | "delete";
type Phase =
  | "idle"
  | "loading"
  | "read-error"
  | "confirm"
  | "saving"
  | "readback"
  | "readback-error"
  | "unknown"
  | "conflict"
  | "reconciling"
  | "reconcile-error"
  | "reconcile"
  | "unavailable"
  | "complete";
type State = {
  meetingId: string;
  owner: string | null;
  action: LifecycleAction | null;
  phase: Phase;
  meeting: Meeting | null;
  latest: Meeting | null;
  writePending: boolean;
  error: string | null;
};
const initialLifecycleState = (
  meetingId: string,
  owner: string | null,
): State => ({
  meetingId,
  owner,
  action: null,
  phase: "idle",
  meeting: null,
  latest: null,
  writePending: false,
  error: null,
});
const authenticatedMemberId = (auth: AuthSnapshot) =>
  auth.status === "authenticated" &&
  !auth.pending &&
  !auth.logoutRequired &&
  auth.session?.user.membership === "member"
    ? auth.session.user.id
    : null;
type ReadMode = "confirmation" | "readback" | "reconciliation";

type Actions = {
  prepare: (action: LifecycleAction, creatorId: string) => Promise<void>;
  close: () => void;
  confirm: () => Promise<void>;
  retry: () => Promise<void>;
  reviewLatest: () => void;
  useLatest: () => void;
};

export function useMeetingLifecycle(
  meetingId: string,
  api: Pick<typeof meetingsApi, "read" | "cancel" | "delete"> = meetingsApi,
) {
  const auth = useAuth(),
    owner = authenticatedMemberId(auth);
  const [state, setState] = useState<State>(() =>
    initialLifecycleState(meetingId, null),
  );
  const actions = useRef<Actions | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      readAbort: AbortController | null = null,
      current = initialLifecycleState(meetingId, null),
      pendingWrite: symbol | null = null;
    const updateLifecycleState = (next: State) => {
      current = next;
      if (active) setState(next);
    };
    const invalidateOperations = () => {
      generation++;
      readAbort?.abort();
      readAbort = null;
    };
    const isCurrentOperation = (operationGeneration: number, ownerId: string) =>
      active &&
      operationGeneration === generation &&
      current.owner === ownerId &&
      authenticatedMemberId(authController.getSnapshot()) === ownerId;
    const isCurrentOwnerAuthenticated = () =>
      current.owner !== null &&
      authenticatedMemberId(authController.getSnapshot()) === current.owner;
    function validateCreatorMeeting(meeting: Meeting, ownerId: string) {
      if (meeting.id !== meetingId)
        throw new MeetingError("INVALID_RESPONSE", 200);
      if (meeting.creatorId !== ownerId)
        throw new MeetingError("MEETING_NOT_FOUND", 404);
      return meeting;
    }
    async function readMeeting(mode: ReadMode) {
      const ownerId = current.owner;
      if (
        !ownerId ||
        !isCurrentOwnerAuthenticated() ||
        !current.action ||
        current.writePending
      )
        return;
      invalidateOperations();
      const operationGeneration = generation;
      readAbort = new AbortController();
      updateLifecycleState({
        ...current,
        phase:
          mode === "readback"
            ? "readback"
            : mode === "reconciliation"
              ? "reconciling"
              : "loading",
        latest: null,
        error: null,
      });
      try {
        const meeting = validateCreatorMeeting(
          await api.read(meetingId, readAbort.signal),
          ownerId,
        );
        if (!isCurrentOperation(operationGeneration, ownerId)) return;
        updateLifecycleState(
          mode === "reconciliation"
            ? { ...current, phase: "reconcile", latest: meeting }
            : {
                ...current,
                phase: mode === "readback" ? "complete" : "confirm",
                meeting,
              },
        );
      } catch (error) {
        if (!isCurrentOperation(operationGeneration, ownerId)) return;
        if (
          error instanceof MeetingError &&
          [401, 403, 404].includes(error.status ?? 0)
        )
          updateLifecycleState({
            ...current,
            phase: "unavailable",
            meeting: null,
            latest: null,
            error: error.code,
          });
        else
          updateLifecycleState({
            ...current,
            phase:
              mode === "readback"
                ? "readback-error"
                : mode === "reconciliation"
                  ? "reconcile-error"
                  : "read-error",
            error: error instanceof MeetingError ? error.code : "NETWORK_ERROR",
          });
      } finally {
        if (operationGeneration === generation) readAbort = null;
      }
    }
    function reconcileIdentity() {
      if (!active) return;
      const snapshot = authController.getSnapshot(),
        next = authenticatedMemberId(snapshot),
        denied =
          snapshot.error instanceof AuthError &&
          [401, 403].includes(snapshot.error.status ?? 0);
      if (
        !snapshot.pending &&
        !snapshot.logoutRequired &&
        (snapshot.status === "checking" ||
          (snapshot.status === "error" && !denied))
      ) {
        invalidateOperations();
        const interrupted: Partial<Record<Phase, Phase>> = {
          saving: "unknown",
          loading: "read-error",
          readback: "readback-error",
          reconciling: "reconcile-error",
        };
        updateLifecycleState({
          ...current,
          phase: interrupted[current.phase] ?? current.phase,
        });
      } else if (next !== current.owner || !next) {
        invalidateOperations();
        pendingWrite = null;
        updateLifecycleState(initialLifecycleState(meetingId, next));
      }
    }
    actions.current = {
      async prepare(action, creatorId) {
        if (
          !isCurrentOwnerAuthenticated() ||
          current.owner !== creatorId ||
          current.phase !== "idle"
        )
          return;
        updateLifecycleState({
          ...initialLifecycleState(meetingId, current.owner),
          action,
        });
        await readMeeting("confirmation");
      },
      close() {
        if (
          isCurrentOwnerAuthenticated() &&
          [
            "loading",
            "read-error",
            "confirm",
            "complete",
            "unavailable",
          ].includes(current.phase) &&
          !current.writePending
        ) {
          invalidateOperations();
          updateLifecycleState(initialLifecycleState(meetingId, current.owner));
        }
      },
      async confirm() {
        const ownerId = current.owner,
          meeting = current.meeting,
          action = current.action;
        if (
          !ownerId ||
          !isCurrentOwnerAuthenticated() ||
          current.phase !== "confirm" ||
          !meeting ||
          !action ||
          current.writePending
        )
          return;
        invalidateOperations();
        const operationGeneration = generation,
          writeId = Symbol();
        pendingWrite = writeId;
        updateLifecycleState({
          ...current,
          phase: "saving",
          writePending: true,
          error: null,
        });
        try {
          if (action === "delete") {
            await api.delete(meetingId, meeting.updatedAt);
          } else {
            const saved = await api.cancel(meetingId, meeting.updatedAt);
            if (!isCurrentOperation(operationGeneration, ownerId)) {
              return;
            }
            validateCreatorMeeting(saved, ownerId);
            if (saved.status !== "CANCELLED") {
              throw new MeetingError("INVALID_RESPONSE", 200);
            }
          }
          if (!isCurrentOperation(operationGeneration, ownerId)) return;
          updateLifecycleState({
            ...current,
            phase: action === "delete" ? "complete" : "readback",
            writePending: false,
          });
          if (action === "cancel") await readMeeting("readback");
        } catch (error) {
          if (!isCurrentOperation(operationGeneration, ownerId)) return;
          if (
            error instanceof MeetingError &&
            [401, 403, 404].includes(error.status ?? 0)
          )
            updateLifecycleState({
              ...current,
              phase: "unavailable",
              meeting: null,
              latest: null,
              writePending: false,
              error: error.code,
            });
          else if (error instanceof MeetingError && error.status === 409)
            updateLifecycleState({
              ...current,
              phase: "conflict",
              writePending: false,
              error: error.code,
            });
          else if (
            error instanceof MeetingError &&
            [400, 415].includes(error.status ?? 0)
          )
            updateLifecycleState({
              ...current,
              phase: "confirm",
              writePending: false,
              error: error.code,
            });
          else
            updateLifecycleState({
              ...current,
              phase: "unknown",
              writePending: false,
              error:
                error instanceof MeetingError ? error.code : "NETWORK_ERROR",
            });
        } finally {
          if (pendingWrite === writeId) {
            pendingWrite = null;
            if (active && current.owner === ownerId && current.writePending)
              updateLifecycleState({ ...current, writePending: false });
          }
        }
      },
      async retry() {
        if (current.phase === "read-error") await readMeeting("confirmation");
        else if (current.phase === "readback-error")
          await readMeeting("readback");
        else if (
          ["unknown", "conflict", "reconcile-error"].includes(current.phase)
        )
          await readMeeting("reconciliation");
      },
      reviewLatest() {
        if (
          isCurrentOwnerAuthenticated() &&
          current.phase === "reconcile" &&
          current.latest
        )
          updateLifecycleState({
            ...current,
            meeting: current.latest,
            latest: null,
            phase: "confirm",
            error: null,
          });
      },
      useLatest() {
        if (
          isCurrentOwnerAuthenticated() &&
          current.phase === "reconcile" &&
          current.latest
        ) {
          invalidateOperations();
          updateLifecycleState(initialLifecycleState(meetingId, current.owner));
        }
      },
    };
    const unsubscribe = authController.subscribe(reconcileIdentity);
    queueMicrotask(reconcileIdentity);
    return () => {
      active = false;
      invalidateOperations();
      unsubscribe();
      actions.current = null;
    };
  }, [meetingId, api]);
  const visible =
    owner !== null && owner === state.owner && state.meetingId === meetingId;
  return {
    ...(visible ? state : initialLifecycleState(meetingId, null)),
    visible,
    prepare: (action: LifecycleAction, creatorId: string) =>
      actions.current?.prepare(action, creatorId),
    close: () => actions.current?.close(),
    confirm: () => actions.current?.confirm(),
    retry: () => actions.current?.retry(),
    reviewLatest: () => actions.current?.reviewLatest(),
    useLatest: () => actions.current?.useLatest(),
  };
}
