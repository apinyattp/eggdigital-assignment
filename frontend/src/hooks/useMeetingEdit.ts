"use client";
import { useEffect, useRef, useState } from "react";
import {
  meetingsApi,
  MeetingError,
  type EditMeetingRequest,
  type Meeting,
  type MeetingStatus,
} from "@/api/meetings";
import { meetingJoinUrl } from "@/utils/meetingLinks";
import type { Member } from "@/api/members";
import { AuthError } from "@/api/auth/authError";
import { authController, type AuthSnapshot } from "./authController";
import { useAuth } from "./useAuth";

export type EditFields = {
  candidateName: string;
  candidateEmail: string;
  position: string;
  title: string;
  description: string;
  preparationNotes: string;
  location: string;
  joinUrl: string;
  status: MeetingStatus;
};
export const editFields = (meeting: Meeting): EditFields => ({
  candidateName: meeting.candidate.name,
  candidateEmail: meeting.candidate.email,
  position: meeting.position,
  title: meeting.title,
  description: meeting.description ?? "",
  preparationNotes: meeting.preparationNotes ?? "",
  location: meeting.location ?? "",
  joinUrl: meeting.joinUrl ?? "",
  status: meeting.status,
});
export function editPayload(
  meeting: Meeting,
  draft: EditFields,
  additions: readonly Member[],
  removals: readonly string[],
) {
  const fields: Record<string, string> = {},
    previous = editFields(meeting);
  for (const key of [
    "candidateName",
    "candidateEmail",
    "position",
    "title",
  ] as const) {
    if (!draft[key].trim()) {
      fields[key] = "This field is required.";
    }
  }
  if (
    draft.candidateEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.candidateEmail.trim())
  ) {
    fields.candidateEmail = "Enter an email in the format name@example.com.";
  }
  if (
    !meeting.attendees.filter((person) => !removals.includes(person.email))
      .length &&
    !additions.length
  ) {
    fields.attendeeChanges =
      "Select at least one interviewer, excluding the organizer.";
  }
  const payload: EditMeetingRequest = { expectedUpdatedAt: meeting.updatedAt };
  for (const key of [
    "candidateName",
    "candidateEmail",
    "position",
    "title",
    "status",
  ] as const) {
    if (draft[key] !== previous[key]) {
      Object.assign(payload, { [key]: draft[key] });
    }
  }
  for (const key of ["description", "preparationNotes", "location"] as const) {
    if (draft[key] !== previous[key]) {
      payload[key] = draft[key] || null;
    }
  }
  if (meeting.format === "ONLINE" && draft.joinUrl !== previous.joinUrl) {
    const joinUrl = draft.joinUrl.trim();
    if (!meetingJoinUrl(joinUrl, "ONLINE", "PENDING")) {
      fields.joinUrl = "Enter a valid HTTPS meeting link.";
    } else {
      payload.joinUrl = joinUrl;
    }
  }
  if (additions.length || removals.length) {
    payload.attendeeChanges = {
      addMemberIds: additions.map((member) => member.id),
      removeEmails: [...removals],
    };
  }
  return { payload, fields };
}
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
  | "reconcile"
  | "reconciling"
  | "reconcile-error"
  | "denied";
type State = {
  meetingId: string;
  owner: string | null;
  phase: Phase;
  meeting: Meeting | null;
  draft: EditFields | null;
  additions: Member[];
  removals: string[];
  fields: Record<string, string>;
  latest: Meeting | null;
  saved: boolean;
  writePending: boolean;
};
const createInitialMeetingEditState = (
  meetingId: string,
  owner: string | null,
): State => ({
  meetingId,
  owner,
  phase: "loading",
  meeting: null,
  draft: null,
  additions: [],
  removals: [],
  fields: {},
  latest: null,
  saved: false,
  writePending: false,
});
const getActiveMemberId = (auth: AuthSnapshot) =>
  auth.status === "authenticated" &&
  !auth.pending &&
  !auth.logoutRequired &&
  auth.session?.user.membership === "member"
    ? auth.session.user.id
    : null;
type Actions = {
  change: <K extends keyof EditFields>(key: K, value: EditFields[K]) => void;
  add: (member: Member) => void;
  removeAdded: (id: string) => void;
  toggleRemoval: (email: string) => void;
  save: () => Promise<void>;
  retry: () => Promise<void>;
  loadLatest: () => Promise<void>;
  resolve: (keepDraft: boolean) => void;
};

export function useMeetingEdit(
  meetingId: string,
  api: Pick<typeof meetingsApi, "read" | "edit"> = meetingsApi,
  initializeWhenEligible = true,
) {
  const auth = useAuth(),
    owner = getActiveMemberId(auth);
  const [state, setState] = useState<State>(() =>
    createInitialMeetingEditState(meetingId, null),
  );
  const actions = useRef<Actions | null>(null);
  const initializationEligible = useRef(initializeWhenEligible);
  const initializeEligibleMeeting = useRef<(() => void) | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      readAbort: AbortController | null = null;
    let current = createInitialMeetingEditState(meetingId, null),
      operation: Readonly<EditMeetingRequest> | null = null,
      pendingWrite: symbol | null = null;
    const publishMeetingEditState = (next: State) => {
      current = next;
      if (active) {
        setState(next);
      }
    };
    const invalidateEditReadAndAbortRequest = () => {
      generation++;
      readAbort?.abort();
      readAbort = null;
    };
    const isCurrentEditRequest = (ticket: number, author: string) =>
      active &&
      ticket === generation &&
      getActiveMemberId(authController.getSnapshot()) === author &&
      current.owner === author;
    const canChangeMeetingDraft = () =>
      current.phase === "ready" &&
      current.owner !== null &&
      getActiveMemberId(authController.getSnapshot()) === current.owner;
    function handleMeetingEditAccessError(error: unknown) {
      if (
        !(error instanceof MeetingError) ||
        ![401, 403, 404].includes(error.status ?? 0)
      ) {
        return false;
      }
      operation = null;
      publishMeetingEditState({
        ...createInitialMeetingEditState(meetingId, current.owner),
        phase: "denied",
      });
      return true;
    }
    function assertExpectedMeetingAndCreator(meeting: Meeting, author: string) {
      if (meeting.id !== meetingId) {
        throw new MeetingError("INVALID_RESPONSE", 200);
      }
      if (meeting.creatorId !== author) {
        throw new MeetingError("MEETING_NOT_FOUND", 404);
      }
      return meeting;
    }
    async function loadMeetingEditState(
      mode: "initial" | "readback" | "conflict" | "reconcile",
    ) {
      const author = current.owner;
      if (
        !author ||
        current.writePending ||
        getActiveMemberId(authController.getSnapshot()) !== author
      ) {
        return;
      }
      invalidateEditReadAndAbortRequest();
      const ticket = generation;
      readAbort = new AbortController();
      publishMeetingEditState({
        ...current,
        latest: null,
        phase:
          mode === "initial"
            ? "loading"
            : mode === "readback"
              ? "readback"
              : mode === "conflict"
                ? "conflict-loading"
                : "reconciling",
      });
      try {
        const meeting = assertExpectedMeetingAndCreator(
          await api.read(meetingId, readAbort.signal),
          author,
        );
        if (!isCurrentEditRequest(ticket, author)) {
          return;
        }
        if (mode === "conflict" || mode === "reconcile") {
          publishMeetingEditState({ ...current, phase: mode, latest: meeting });
        } else {
          operation = null;
          publishMeetingEditState({
            ...createInitialMeetingEditState(meetingId, author),
            phase: "ready",
            meeting,
            draft: editFields(meeting),
            saved: mode === "readback",
          });
        }
      } catch (error) {
        if (
          !isCurrentEditRequest(ticket, author) ||
          handleMeetingEditAccessError(error)
        ) {
          return;
        }
        publishMeetingEditState({
          ...current,
          phase:
            mode === "initial"
              ? "error"
              : mode === "readback"
                ? "readback-error"
                : mode === "conflict"
                  ? "conflict-error"
                  : "reconcile-error",
        });
      } finally {
        if (ticket === generation) {
          readAbort = null;
        }
      }
    }
    async function submitMeetingEditAndReadBack() {
      const author = current.owner,
        payload = operation;
      if (
        !author ||
        !payload ||
        current.writePending ||
        getActiveMemberId(authController.getSnapshot()) !== author
      ) {
        return;
      }
      invalidateEditReadAndAbortRequest();
      const ticket = generation,
        write = Symbol();
      pendingWrite = write;
      publishMeetingEditState({
        ...current,
        phase: "saving",
        fields: {},
        saved: false,
        writePending: true,
      });
      try {
        const meeting = await api.edit(meetingId, payload);
        if (!isCurrentEditRequest(ticket, author)) {
          return;
        }
        assertExpectedMeetingAndCreator(meeting, author);
        publishMeetingEditState({
          ...current,
          saved: true,
          writePending: false,
        });
        await loadMeetingEditState("readback");
      } catch (error) {
        if (
          !isCurrentEditRequest(ticket, author) ||
          handleMeetingEditAccessError(error)
        ) {
          return;
        }
        if (error instanceof MeetingError && error.status === 409) {
          operation = null;
          publishMeetingEditState({
            ...current,
            phase: "conflict",
            latest: null,
            writePending: false,
          });
        } else if (
          error instanceof MeetingError &&
          [400, 415].includes(error.status ?? 0)
        ) {
          operation = null;
          publishMeetingEditState({
            ...current,
            phase: "ready",
            fields: Object.keys(error.fields).length
              ? error.fields
              : {
                  form: "Unable to save. Check the information and try again.",
                },
            writePending: false,
          });
        } else {
          publishMeetingEditState({
            ...current,
            phase: "unknown",
            writePending: false,
          });
        }
      } finally {
        // A same-account identity check can interrupt the UI while POST is in
        // flight. Do not start reconciliation until that request has settled.
        if (pendingWrite === write) {
          pendingWrite = null;
          if (active && current.owner === author && current.writePending) {
            publishMeetingEditState({ ...current, writePending: false });
          }
        }
      }
    }
    function reconcileMeetingEditWithIdentity() {
      if (!active) {
        return;
      }
      const snapshot = authController.getSnapshot(),
        next = getActiveMemberId(snapshot);
      const deniedIdentity =
        snapshot.error instanceof AuthError &&
        [401, 403].includes(snapshot.error.status ?? 0);
      if (
        !snapshot.pending &&
        !snapshot.logoutRequired &&
        (snapshot.status === "checking" ||
          (snapshot.status === "error" && !deniedIdentity))
      ) {
        invalidateEditReadAndAbortRequest();
        const interrupted: Partial<Record<Phase, Phase>> = {
          loading: "error",
          saving: "unknown",
          readback: "readback-error",
          "conflict-loading": "conflict-error",
          reconciling: "reconcile-error",
        };
        publishMeetingEditState({
          ...current,
          phase: interrupted[current.phase] ?? current.phase,
        });
      } else if (!next) {
        invalidateEditReadAndAbortRequest();
        operation = null;
        pendingWrite = null;
        publishMeetingEditState(createInitialMeetingEditState(meetingId, null));
      } else if (next !== current.owner) {
        invalidateEditReadAndAbortRequest();
        operation = null;
        pendingWrite = null;
        publishMeetingEditState(createInitialMeetingEditState(meetingId, null));
        if (initializationEligible.current) {
          publishMeetingEditState(
            createInitialMeetingEditState(meetingId, next),
          );
          void loadMeetingEditState("initial");
        }
      }
      // Same-author L4 return preserves the draft and does not POST or replace it.
    }
    actions.current = {
      change(key, value) {
        if (canChangeMeetingDraft() && current.draft) {
          publishMeetingEditState({
            ...current,
            draft: { ...current.draft, [key]: value },
            fields: {},
            saved: false,
          });
        }
      },
      add(member) {
        if (
          !canChangeMeetingDraft() ||
          !current.meeting ||
          member.id === current.owner ||
          current.additions.some(
            (person) =>
              person.id === member.id || person.email === member.email,
          ) ||
          current.meeting.attendees.some(
            (person) =>
              person.memberId === member.id || person.email === member.email,
          )
        ) {
          return;
        }
        publishMeetingEditState({
          ...current,
          additions: [...current.additions, member],
          fields: {},
          saved: false,
        });
      },
      removeAdded(id) {
        if (canChangeMeetingDraft()) {
          publishMeetingEditState({
            ...current,
            additions: current.additions.filter((person) => person.id !== id),
            fields: {},
            saved: false,
          });
        }
      },
      toggleRemoval(email) {
        if (
          canChangeMeetingDraft() &&
          current.meeting?.attendees.some((person) => person.email === email)
        ) {
          publishMeetingEditState({
            ...current,
            removals: current.removals.includes(email)
              ? current.removals.filter((value) => value !== email)
              : [...current.removals, email],
            fields: {},
            saved: false,
          });
        }
      },
      async save() {
        if (
          !canChangeMeetingDraft() ||
          !current.meeting ||
          !current.draft ||
          operation
        ) {
          return;
        }
        const { payload, fields } = editPayload(
          current.meeting,
          current.draft,
          current.additions,
          current.removals,
        );
        if (Object.keys(fields).length) {
          publishMeetingEditState({ ...current, fields, saved: false });
          return;
        }
        operation = Object.freeze({
          ...payload,
          ...(payload.attendeeChanges
            ? {
                attendeeChanges: Object.freeze({
                  addMemberIds: Object.freeze([
                    ...payload.attendeeChanges.addMemberIds,
                  ]),
                  removeEmails: Object.freeze([
                    ...payload.attendeeChanges.removeEmails,
                  ]),
                }),
              }
            : {}),
        });
        await submitMeetingEditAndReadBack();
      },
      async retry() {
        if (current.phase === "error") {
          await loadMeetingEditState("initial");
        } else if (current.phase === "readback-error") {
          await loadMeetingEditState("readback");
        } else if (
          current.phase === "unknown" ||
          current.phase === "reconcile-error"
        ) {
          await loadMeetingEditState("reconcile");
        } else if (current.phase === "conflict-error") {
          await loadMeetingEditState("conflict");
        }
      },
      async loadLatest() {
        if (
          current.phase === "conflict" ||
          current.phase === "conflict-error"
        ) {
          await loadMeetingEditState("conflict");
        } else if (current.phase === "reconcile") {
          await loadMeetingEditState("reconcile");
        }
      },
      resolve(keepDraft) {
        if (
          !current.latest ||
          !current.meeting ||
          !current.draft ||
          !["conflict", "reconcile"].includes(current.phase) ||
          getActiveMemberId(authController.getSnapshot()) !== current.owner
        ) {
          return;
        }
        const meeting = current.latest,
          original = editFields(current.meeting),
          draft = editFields(meeting);
        if (keepDraft) {
          for (const key of Object.keys(draft) as (keyof EditFields)[]) {
            if (current.draft[key] !== original[key]) {
              Object.assign(draft, { [key]: current.draft[key] });
            }
          }
        }
        const additions = keepDraft
          ? current.additions.filter(
              (person) =>
                !meeting.attendees.some(
                  (existing) =>
                    existing.memberId === person.id ||
                    existing.email === person.email,
                ),
            )
          : [];
        const removals = keepDraft
          ? current.removals.filter((email) =>
              meeting.attendees.some((person) => person.email === email),
            )
          : [];
        operation = null;
        publishMeetingEditState({
          ...createInitialMeetingEditState(meetingId, current.owner),
          meeting,
          draft,
          additions,
          removals,
          phase: "ready",
        });
      },
    };
    initializeEligibleMeeting.current = reconcileMeetingEditWithIdentity;
    const unsubscribe = authController.subscribe(
      reconcileMeetingEditWithIdentity,
    );
    queueMicrotask(reconcileMeetingEditWithIdentity);
    return () => {
      active = false;
      invalidateEditReadAndAbortRequest();
      unsubscribe();
      actions.current = null;
      initializeEligibleMeeting.current = null;
    };
  }, [meetingId, api]);
  useEffect(() => {
    initializationEligible.current = initializeWhenEligible;
    initializeEligibleMeeting.current?.();
  }, [initializeWhenEligible]);
  const visible =
    owner !== null && state.owner === owner && state.meetingId === meetingId;
  const view = visible ? state : createInitialMeetingEditState(meetingId, null);
  return {
    ...view,
    visible,
    locked: !visible || view.phase !== "ready",
    change: <K extends keyof EditFields>(key: K, value: EditFields[K]) =>
      actions.current?.change(key, value),
    add: (member: Member) => actions.current?.add(member),
    removeAdded: (id: string) => actions.current?.removeAdded(id),
    toggleRemoval: (email: string) => actions.current?.toggleRemoval(email),
    save: () => actions.current?.save(),
    retry: () => actions.current?.retry(),
    loadLatest: () => actions.current?.loadLatest(),
    resolve: (keepDraft: boolean) => actions.current?.resolve(keepDraft),
  };
}
