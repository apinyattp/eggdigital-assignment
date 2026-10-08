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
const empty = (meetingId: string, owner: string | null): State => ({
  meetingId,
  owner,
  action: null,
  phase: "idle",
  meeting: null,
  latest: null,
  writePending: false,
  error: null,
});
const identity = (auth: AuthSnapshot) =>
  auth.status === "authenticated" &&
  !auth.pending &&
  !auth.logoutRequired &&
  auth.session?.user.membership === "member"
    ? auth.session.user.id
    : null;
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
    owner = identity(auth);
  const [state, setState] = useState<State>(() => empty(meetingId, null));
  const actions = useRef<Actions | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      readAbort: AbortController | null = null,
      current = empty(meetingId, null),
      pendingWrite: symbol | null = null;
    const publish = (next: State) => {
      current = next;
      if (active) setState(next);
    };
    const invalidate = () => {
      generation++;
      readAbort?.abort();
      readAbort = null;
    };
    const valid = (ticket: number, author: string) =>
      active &&
      ticket === generation &&
      current.owner === author &&
      identity(authController.getSnapshot()) === author;
    const allowed = () =>
      current.owner !== null &&
      identity(authController.getSnapshot()) === current.owner;
    function verify(meeting: Meeting, author: string) {
      if (meeting.id !== meetingId)
        throw new MeetingError("INVALID_RESPONSE", 200);
      if (meeting.creatorId !== author)
        throw new MeetingError("MEETING_NOT_FOUND", 404);
      return meeting;
    }
    async function read(reconcile: boolean, readback = false) {
      const author = current.owner;
      if (!author || !allowed() || !current.action || current.writePending)
        return;
      invalidate();
      const ticket = generation;
      readAbort = new AbortController();
      publish({
        ...current,
        phase: readback ? "readback" : reconcile ? "reconciling" : "loading",
        latest: null,
        error: null,
      });
      try {
        const meeting = verify(
          await api.read(meetingId, readAbort.signal),
          author,
        );
        if (!valid(ticket, author)) return;
        publish(
          reconcile
            ? { ...current, phase: "reconcile", latest: meeting }
            : { ...current, phase: readback ? "complete" : "confirm", meeting },
        );
      } catch (error) {
        if (!valid(ticket, author)) return;
        if (
          error instanceof MeetingError &&
          [401, 403, 404].includes(error.status ?? 0)
        )
          publish({
            ...current,
            phase: "unavailable",
            meeting: null,
            latest: null,
            error: error.code,
          });
        else
          publish({
            ...current,
            phase: readback
              ? "readback-error"
              : reconcile
                ? "reconcile-error"
                : "read-error",
            error: error instanceof MeetingError ? error.code : "NETWORK_ERROR",
          });
      } finally {
        if (ticket === generation) readAbort = null;
      }
    }
    function reconcileIdentity() {
      if (!active) return;
      const snapshot = authController.getSnapshot(),
        next = identity(snapshot),
        denied =
          snapshot.error instanceof AuthError &&
          [401, 403].includes(snapshot.error.status ?? 0);
      if (
        !snapshot.pending &&
        !snapshot.logoutRequired &&
        (snapshot.status === "checking" ||
          (snapshot.status === "error" && !denied))
      ) {
        invalidate();
        const interrupted: Partial<Record<Phase, Phase>> = {
          saving: "unknown",
          loading: "read-error",
          readback: "readback-error",
          reconciling: "reconcile-error",
        };
        publish({
          ...current,
          phase: interrupted[current.phase] ?? current.phase,
        });
      } else if (next !== current.owner || !next) {
        invalidate();
        pendingWrite = null;
        publish(empty(meetingId, next));
      }
    }
    actions.current = {
      async prepare(action, creatorId) {
        if (
          !allowed() ||
          current.owner !== creatorId ||
          current.phase !== "idle"
        )
          return;
        publish({ ...empty(meetingId, current.owner), action });
        await read(false);
      },
      close() {
        if (
          allowed() &&
          [
            "loading",
            "read-error",
            "confirm",
            "complete",
            "unavailable",
          ].includes(current.phase) &&
          !current.writePending
        ) {
          invalidate();
          publish(empty(meetingId, current.owner));
        }
      },
      async confirm() {
        const author = current.owner,
          meeting = current.meeting,
          action = current.action;
        if (
          !author ||
          !allowed() ||
          current.phase !== "confirm" ||
          !meeting ||
          !action ||
          current.writePending
        )
          return;
        invalidate();
        const ticket = generation,
          write = Symbol();
        pendingWrite = write;
        publish({
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
            if (!valid(ticket, author)) {
              return;
            }
            verify(saved, author);
            if (saved.status !== "CANCELLED") {
              throw new MeetingError("INVALID_RESPONSE", 200);
            }
          }
          if (!valid(ticket, author)) return;
          publish({
            ...current,
            phase: action === "delete" ? "complete" : "readback",
            writePending: false,
          });
          if (action === "cancel") await read(false, true);
        } catch (error) {
          if (!valid(ticket, author)) return;
          if (
            error instanceof MeetingError &&
            [401, 403, 404].includes(error.status ?? 0)
          )
            publish({
              ...current,
              phase: "unavailable",
              meeting: null,
              latest: null,
              writePending: false,
              error: error.code,
            });
          else if (error instanceof MeetingError && error.status === 409)
            publish({
              ...current,
              phase: "conflict",
              writePending: false,
              error: error.code,
            });
          else if (
            error instanceof MeetingError &&
            [400, 415].includes(error.status ?? 0)
          )
            publish({
              ...current,
              phase: "confirm",
              writePending: false,
              error: error.code,
            });
          else
            publish({
              ...current,
              phase: "unknown",
              writePending: false,
              error:
                error instanceof MeetingError ? error.code : "NETWORK_ERROR",
            });
        } finally {
          if (pendingWrite === write) {
            pendingWrite = null;
            if (active && current.owner === author && current.writePending)
              publish({ ...current, writePending: false });
          }
        }
      },
      async retry() {
        if (current.phase === "read-error") await read(false);
        else if (current.phase === "readback-error") await read(false, true);
        else if (
          ["unknown", "conflict", "reconcile-error"].includes(current.phase)
        )
          await read(true);
      },
      reviewLatest() {
        if (allowed() && current.phase === "reconcile" && current.latest)
          publish({
            ...current,
            meeting: current.latest,
            latest: null,
            phase: "confirm",
            error: null,
          });
      },
      useLatest() {
        if (allowed() && current.phase === "reconcile" && current.latest) {
          invalidate();
          publish(empty(meetingId, current.owner));
        }
      },
    };
    const unsubscribe = authController.subscribe(reconcileIdentity);
    queueMicrotask(reconcileIdentity);
    return () => {
      active = false;
      invalidate();
      unsubscribe();
      actions.current = null;
    };
  }, [meetingId, api]);
  const visible =
    owner !== null && owner === state.owner && state.meetingId === meetingId;
  return {
    ...(visible ? state : empty(meetingId, null)),
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
