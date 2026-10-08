"use client";
import { useEffect, useRef, useState } from "react";
import { meetingSummaryApi, type MeetingSummary } from "@/api/meetingSummary";
import { MeetingError } from "@/api/meetings";
import { authController, type AuthSnapshot } from "./authController";
import { useAuth } from "./useAuth";
const getAuthenticatedIdentityKey = (auth: AuthSnapshot) =>
  auth.status === "authenticated" &&
  auth.session &&
  !auth.pending &&
  !auth.logoutRequired
    ? `${auth.session.user.membership}:${auth.session.user.id ?? auth.session.user.email}`
    : null;
type State = {
  meetingId: string;
  principal: string | null;
  phase: "loading" | "ready" | "error" | "denied";
  meeting: MeetingSummary | null;
};
export function useMeetingSummary(meetingId: string, api = meetingSummaryApi) {
  const auth = useAuth(),
    principal = getAuthenticatedIdentityKey(auth);
  const [state, setState] = useState<State>({
    meetingId,
    principal: null,
    phase: "loading",
    meeting: null,
  });
  const reload = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    let active = true,
      generation = 0,
      owner: string | null = null,
      controller: AbortController | null = null;
    const invalidateSummaryRequest = () => {
      generation++;
      controller?.abort();
      controller = null;
    };
    async function loadMeetingSummary() {
      const next = getAuthenticatedIdentityKey(authController.getSnapshot());
      if (!active || !next) {
        return;
      }
      owner = next;
      invalidateSummaryRequest();
      const ticket = generation;
      controller = new AbortController();
      setState((previous) => ({
        meetingId,
        principal: next,
        phase: "loading",
        meeting:
          previous.principal === next && previous.meetingId === meetingId
            ? previous.meeting
            : null,
      }));
      try {
        const meeting = await api.read(meetingId, controller.signal);
        if (
          active &&
          ticket === generation &&
          getAuthenticatedIdentityKey(authController.getSnapshot()) === next
        ) {
          setState({ meetingId, principal: next, phase: "ready", meeting });
        }
      } catch (error) {
        if (
          !active ||
          ticket !== generation ||
          getAuthenticatedIdentityKey(authController.getSnapshot()) !== next
        ) {
          return;
        }
        const denied =
          error instanceof MeetingError &&
          [401, 403, 404].includes(error.status ?? 0);
        setState({
          meetingId,
          principal: next,
          phase: denied ? "denied" : "error",
          meeting: null,
        });
        // The host owns session refresh. Repeating it here after persistent 403
        // would cause an auth/summary request loop.
      }
    }
    function syncSummaryWithIdentity() {
      if (!active) {
        return;
      }
      const snapshot = authController.getSnapshot(),
        next = getAuthenticatedIdentityKey(snapshot);
      if (snapshot.status === "checking") {
        invalidateSummaryRequest();
        return;
      }
      if (!next) {
        owner = null;
        invalidateSummaryRequest();
        setState({
          meetingId,
          principal: null,
          phase: "loading",
          meeting: null,
        });
      } else {
        if (owner !== next) {
          setState({
            meetingId,
            principal: next,
            phase: "loading",
            meeting: null,
          });
        }
        void loadMeetingSummary();
      }
    }
    reload.current = loadMeetingSummary;
    const unsubscribe = authController.subscribe(syncSummaryWithIdentity);
    queueMicrotask(syncSummaryWithIdentity);
    return () => {
      active = false;
      invalidateSummaryRequest();
      unsubscribe();
      reload.current = null;
    };
  }, [meetingId, api]);
  const visible =
    principal !== null &&
    state.principal === principal &&
    state.meetingId === meetingId;
  return {
    phase: visible ? state.phase : "loading",
    meeting: visible ? state.meeting : null,
    refresh: () => reload.current?.(),
  };
}
