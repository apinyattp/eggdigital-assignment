"use client";
import { useEffect, useRef, useState } from "react";
import { meetingListApi, type MeetingList } from "@/api/meetingList";
import { MeetingError } from "@/api/meetings";

type State = {
  key: string;
  phase: "loading" | "ready" | "error" | "denied";
  data: MeetingList | null;
  morePending: boolean;
  moreError: boolean;
  accessError: MeetingError | null;
};
export function useMeetingList(
  date: string,
  principal: string,
  api = meetingListApi,
) {
  const key = `${principal}|${date}`;
  const previousDate = useRef(date);
  const [state, setState] = useState<State>({
    key,
    phase: "loading",
    data: null,
    morePending: false,
    moreError: false,
    accessError: null,
  });
  const actions = useRef<{
    refresh: () => Promise<void>;
    more: () => Promise<void>;
  } | null>(null);
  useEffect(() => {
    // Match the reference disclosure duration, only when the selected day changes.
    let minimumLoadingMs = previousDate.current === date ? 0 : 220;
    previousDate.current = date;
    let loadingTimer: ReturnType<typeof setTimeout> | undefined;
    let finishLoadingWait: (() => void) | undefined;
    let active = true,
      generation = 0,
      pending = false,
      receivedAt = 0;
    let data: MeetingList | null = null,
      controller: AbortController | null = null,
      timer: ReturnType<typeof setTimeout> | undefined;
    function invalidateListRequestAndCancelRefresh() {
      generation++;
      controller?.abort();
      clearTimeout(timer);
      clearTimeout(loadingTimer);
      finishLoadingWait?.();
      finishLoadingWait = undefined;
    }
    async function finishDateTransition(startedAt: number, minimumMs: number) {
      const remaining = minimumMs - (Date.now() - startedAt);
      if (remaining <= 0) { return; }
      await new Promise<void>((resolve) => {
        finishLoadingWait = resolve;
        loadingTimer = setTimeout(() => {
          finishLoadingWait = undefined;
          resolve();
        }, remaining);
      });
    }
    function isMeetingListAccessError(error: unknown) {
      return (
        error instanceof MeetingError && [401, 403].includes(error.status ?? 0)
      );
    }
    function scheduleRefreshAtNextMeetingEnd(result: MeetingList) {
      clearTimeout(timer);
      const ends = result.groups.upcomingCurrent.items
        .map((item) => Date.parse(item.endsAt))
        .filter(Number.isFinite);
      if (!ends.length) {
        return;
      }
      // Server owns classification. Refresh just after the earliest displayed end;
      // use server reference time, never move a card between groups on the client.
      const delay = Math.max(
        1000,
        Math.min(
          Math.min(...ends) -
            Date.parse(result.referenceTime) -
            (Date.now() - receivedAt) +
            1,
          2_147_483_647,
        ),
      );
      timer = setTimeout(() => {
        void reloadMeetingList();
      }, delay);
    }
    async function reloadMeetingList() {
      if (!active) {
        return;
      }
      invalidateListRequestAndCancelRefresh();
      const ticket = generation;
      const startedAt = Date.now();
      const visualMinimumMs = minimumLoadingMs;
      minimumLoadingMs = 0;
      pending = true;
      controller = new AbortController();
      data = null;
      setState({
        key,
        phase: "loading",
        data: null,
        morePending: false,
        moreError: false,
        accessError: null,
      });
      try {
        const result = await api.read(date, controller.signal);
        if (!active || ticket !== generation) { return; }
        const responseReceivedAt = Date.now();
        await finishDateTransition(startedAt, visualMinimumMs);
        if (!active || ticket !== generation) { return; }
        data = result;
        receivedAt = responseReceivedAt;
        scheduleRefreshAtNextMeetingEnd(result);
        setState({
          key,
          phase: "ready",
          data,
          morePending: false,
          moreError: false,
          accessError: null,
        });
      } catch (error) {
        if (!active || ticket !== generation) { return; }
        // Access denial is never delayed for visual smoothing.
        if (!isMeetingListAccessError(error)) {
          await finishDateTransition(startedAt, visualMinimumMs);
        }
        if (!active || ticket !== generation) { return; }
        setState({
          key,
          phase: isMeetingListAccessError(error) ? "denied" : "error",
          data: null,
          morePending: false,
          moreError: false,
          accessError: isMeetingListAccessError(error)
            ? (error as MeetingError)
            : null,
        });
      } finally {
        if (active && ticket === generation) {
          pending = false;
        }
      }
    }
    async function loadNextCurrentPage() {
      const group = data?.groups.upcomingCurrent;
      if (
        !active ||
        pending ||
        !data ||
        !group ||
        group.page * group.pageSize >= group.total
      ) {
        return;
      }
      pending = true;
      const ticket = generation,
        previous = data;
      controller = new AbortController();
      setState((previous) => ({
        ...previous,
        morePending: true,
        moreError: false,
      }));
      try {
        const result = await api.more(
          date,
          group.page + 1,
          data.snapshot,
          controller.signal,
        );
        if (!active || ticket !== generation) {
          return;
        }
        if (
          result.referenceTime !== previous.referenceTime ||
          result.group.total !== previous.groups.upcomingCurrent.total ||
          result.snapshot !== previous.snapshot
        ) {
          await reloadMeetingList();
          return;
        }
        const loaded = new Set(
          previous.groups.upcomingCurrent.items.map((item) => item.id),
        );
        data = {
          ...previous,
          groups: {
            ...previous.groups,
            upcomingCurrent: {
              ...result.group,
              items: [
                ...previous.groups.upcomingCurrent.items,
                ...result.group.items.filter((item) => !loaded.has(item.id)),
              ],
            },
          },
        };
        scheduleRefreshAtNextMeetingEnd(data);
        setState({
          key,
          phase: "ready",
          data,
          morePending: false,
          moreError: false,
          accessError: null,
        });
      } catch (error) {
        if (!active || ticket !== generation) {
          return;
        }
        if (
          error instanceof MeetingError &&
          (error.code === "LIST_CHANGED" || error.code === "INVALID_CURSOR")
        ) {
          await reloadMeetingList();
          return;
        }
        if (isMeetingListAccessError(error)) {
          data = null;
          clearTimeout(timer);
          setState({
            key,
            phase: "denied",
            data: null,
            morePending: false,
            moreError: false,
            accessError: error as MeetingError,
          });
        } else {
          setState((previous) => ({
            ...previous,
            morePending: false,
            moreError: true,
          }));
        }
      } finally {
        if (active && ticket === generation) {
          pending = false;
        }
      }
    }
    actions.current = { refresh: reloadMeetingList, more: loadNextCurrentPage };
    queueMicrotask(() => {
      void reloadMeetingList();
    });
    return () => {
      active = false;
      invalidateListRequestAndCancelRefresh();
      actions.current = null;
    };
  }, [date, principal, key, api]);
  const visible = state.key === key;
  return {
    ...state,
    phase: visible ? state.phase : "loading",
    data: visible ? state.data : null,
    morePending: visible && state.morePending,
    moreError: visible && state.moreError,
    accessError: visible ? state.accessError : null,
    refresh: () => actions.current?.refresh(),
    loadMore: () => actions.current?.more(),
  };
}
