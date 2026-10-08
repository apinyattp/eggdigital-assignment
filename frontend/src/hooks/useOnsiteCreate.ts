"use client";

import { useEffect, useRef, useState } from "react";
import {
  MeetingError,
  meetingsApi,
  type CreateOnsiteRequest,
  type CreateOnlineRequest,
  type CreateMeetingRequest,
  type Meeting,
} from "@/api/meetings";
import { AuthError } from "@/api/auth/authError";
import { Membership } from "@/enums/membership";
import { authController } from "./authController";
import { useAuth } from "./useAuth";

export type OnsiteDraft = Omit<CreateOnsiteRequest, "requestId">;
export type OnlineDraft = Omit<CreateOnlineRequest, "requestId">;
type Phase =
  | "idle"
  | "saving"
  | "unknown"
  | "rejected"
  | "reading"
  | "read-error"
  | "saved"
  | "deleted";
type State = {
  ownerId: string | null;
  phase: Phase;
  meeting: Meeting | null;
  fields: Record<string, string>;
};
type Operation = {
  ownerId: string;
  payload: CreateMeetingRequest;
  meetingId?: string;
};
const createInitialMeetingCreateState = (ownerId: string | null): State => ({
  ownerId,
  phase: "idle",
  meeting: null,
  fields: {},
});
function currentMemberId() {
  const auth = authController.getSnapshot();
  return auth.status === "authenticated" &&
    !auth.pending &&
    !auth.logoutRequired &&
    auth.session?.user.membership === Membership.Member
    ? auth.session.user.id
    : null;
}

export function useOnsiteCreate(
  api: Pick<typeof meetingsApi, "create" | "read"> = meetingsApi,
) {
  const auth = useAuth();
  const ownerId =
    auth.status === "authenticated" &&
    !auth.pending &&
    !auth.logoutRequired &&
    auth.session?.user.membership === Membership.Member
      ? auth.session.user.id
      : null;
  const [state, setState] = useState<State>(() =>
    createInitialMeetingCreateState(currentMemberId()),
  );
  const stateRef = useRef(state);
  const operation = useRef<Operation | null>(null);
  const generation = useRef(0);
  function publishMeetingCreateState(next: State) {
    stateRef.current = next;
    setState(next);
  }

  useEffect(() => {
    const invalidateCreateResponseGeneration = () => {
      generation.current++;
    };
    const unsubscribe = authController.subscribe(() => {
      invalidateCreateResponseGeneration();
      const snapshot = authController.getSnapshot();
      const nextOwner = currentMemberId();
      const denied =
        snapshot.error instanceof AuthError &&
        (snapshot.error.status === 401 ||
          snapshot.error.status === 403 ||
          snapshot.error.code === "CANDIDATE_DENIED");
      if (
        !snapshot.pending &&
        !snapshot.logoutRequired &&
        (snapshot.status === "checking" ||
          (snapshot.status === "error" && !denied))
      ) {
        // Unresolved L4 failures hide private state, but do not prove logout or
        // rollback. Preserve the exact operation until identity is resolved.
        const previous = stateRef.current;
        const phase =
          previous.phase === "saving"
            ? "unknown"
            : previous.phase === "reading"
              ? "read-error"
              : previous.phase;
        publishMeetingCreateState({ ...previous, phase });
      } else if (!nextOwner || stateRef.current.ownerId !== nextOwner) {
        operation.current = null;
        publishMeetingCreateState(createInitialMeetingCreateState(nextOwner));
      }
    });
    return () => {
      invalidateCreateResponseGeneration();
      unsubscribe();
    };
  }, []);

  function isCurrentCreateOperation(op: Operation, ticket: number) {
    return (
      generation.current === ticket &&
      currentMemberId() === op.ownerId &&
      operation.current === op
    );
  }
  async function loadCreatedMeeting(op: Operation, ticket: number) {
    if (!op.meetingId || !isCurrentCreateOperation(op, ticket)) {
      return;
    }
    publishMeetingCreateState({
      ownerId: op.ownerId,
      phase: "reading",
      meeting: null,
      fields: {},
    });
    try {
      const meeting = await api.read(op.meetingId);
      if (isCurrentCreateOperation(op, ticket)) {
        publishMeetingCreateState({
          ownerId: op.ownerId,
          phase: "saved",
          meeting,
          fields: {},
        });
      }
    } catch (error) {
      if (!isCurrentCreateOperation(op, ticket)) {
        return;
      }
      publishMeetingCreateState({
        ownerId: op.ownerId,
        phase: "read-error",
        meeting: null,
        fields: {},
      });
      if (
        error instanceof MeetingError &&
        (error.status === 401 || error.status === 403)
      ) {
        void authController.refresh();
      }
    }
  }
  async function submitMeetingCreationAndReadBack(op: Operation) {
    const ticket = ++generation.current;
    publishMeetingCreateState({
      ownerId: op.ownerId,
      phase: "saving",
      meeting: null,
      fields: {},
    });
    try {
      const result = await api.create(op.payload);
      if (!isCurrentCreateOperation(op, ticket)) {
        return;
      }
      op.meetingId = result.meeting.id;
      await loadCreatedMeeting(op, ticket);
    } catch (error) {
      if (!isCurrentCreateOperation(op, ticket)) {
        return;
      }
      if (
        error instanceof MeetingError &&
        error.status === 410 &&
        error.code === "MEETING_DELETED"
      ) {
        operation.current = null;
        publishMeetingCreateState({
          ownerId: op.ownerId,
          phase: "deleted",
          meeting: null,
          fields: {},
        });
        return;
      }
      // Validation/media rejection permits correction. Every 503, network
      // failure, 500 or malformed success retains the exact key+payload.
      const rejected =
        error instanceof MeetingError &&
        (error.status === 400 || error.status === 415);
      if (rejected) {
        operation.current = null;
      }
      publishMeetingCreateState({
        ownerId: op.ownerId,
        phase: rejected ? "rejected" : "unknown",
        meeting: null,
        fields: rejected && error instanceof MeetingError ? error.fields : {},
      });
      if (
        error instanceof MeetingError &&
        (error.status === 401 || error.status === 403)
      ) {
        void authController.refresh();
      }
    }
  }
  const visible = !!ownerId && state.ownerId === ownerId;
  const phase = visible ? state.phase : "idle";
  return {
    phase,
    meeting: visible ? state.meeting : null,
    fields: visible ? state.fields : {},
    locked: !visible || (phase !== "idle" && phase !== "rejected"),
    save: (draft: OnsiteDraft | OnlineDraft) => {
      if (
        !ownerId ||
        currentMemberId() !== ownerId ||
        operation.current ||
        !["idle", "rejected"].includes(stateRef.current.phase)
      ) {
        return;
      }
      const payload = Object.freeze({
        ...draft,
        attendeeMemberIds: Object.freeze([...draft.attendeeMemberIds]),
        requestId: crypto.randomUUID(),
      });
      const op: Operation = { ownerId, payload };
      operation.current = op;
      return submitMeetingCreationAndReadBack(op);
    },
    retry: () => {
      const op = operation.current;
      if (!op || currentMemberId() !== op.ownerId) {
        return;
      }
      if (stateRef.current.phase === "unknown") {
        return submitMeetingCreationAndReadBack(op);
      }
      if (stateRef.current.phase === "read-error") {
        return loadCreatedMeeting(op, ++generation.current);
      }
    },
  };
}
