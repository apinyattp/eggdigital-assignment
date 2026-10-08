"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MemberLookupError, membersApi, type Member } from "@/api/members";
import { AuthError } from "@/api/auth/authError";
import { Membership } from "@/enums/membership";
import { authController } from "./authController";
import { useAuth } from "./useAuth";

type PickerState = {
  ownerId: string | null;
  query: string;
  selected: Member[];
  items: Member[];
  page: number;
  total: number;
  failedPage: number;
  phase: "idle" | "loading" | "ready" | "error";
};
const empty = (ownerId: string | null): PickerState => ({
  ownerId,
  query: "",
  selected: [],
  items: [],
  page: 0,
  total: 0,
  failedPage: 1,
  phase: "idle",
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

export function useMemberPicker(locked = false, api = membersApi) {
  const auth = useAuth();
  const ownerId =
    auth.status === "authenticated" &&
    !auth.pending &&
    !auth.logoutRequired &&
    auth.session?.user.membership === Membership.Member
      ? auth.session.user.id
      : null;
  const [state, setState] = useState<PickerState>(() =>
    empty(currentMemberId()),
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<{
    generation: number;
    controller: AbortController | null;
  }>({ generation: 0, controller: null });

  const invalidate = useCallback(() => {
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
    request.current.generation++;
    request.current.controller?.abort();
    request.current.controller = null;
  }, []);

  useEffect(() => {
    const unsubscribe = authController.subscribe(() => {
      invalidate();
      const snapshot = authController.getSnapshot();
      const nextOwner = currentMemberId();
      const denied =
        snapshot.error instanceof AuthError &&
        (snapshot.error.status === 401 ||
          snapshot.error.status === 403 ||
          snapshot.error.code === "CANDIDATE_DENIED");
      setState((previous) => {
        // Unresolved L4 rechecks/errors hide suggestions and retain the draft selection.
        if (
          !snapshot.pending &&
          !snapshot.logoutRequired &&
          (snapshot.status === "checking" ||
            (snapshot.status === "error" && !denied))
        )
          return { ...previous, items: [], page: 0, total: 0, phase: "idle" };
        if (!nextOwner || previous.ownerId !== nextOwner)
          return empty(nextOwner);
        return { ...previous, items: [], page: 0, total: 0, phase: "idle" };
      });
    });
    return () => {
      unsubscribe();
      invalidate();
    };
  }, [invalidate]);

  useEffect(() => {
    if (locked && debounce.current !== null) {
      invalidate();
      setState((previous) => ({ ...previous, phase: "idle" }));
    }
  }, [locked, invalidate]);

  function search(query: string, pageNumber = 1, delay = false) {
    if (locked || !ownerId || currentMemberId() !== ownerId) return;
    invalidate();
    const generation = request.current.generation;
    const controller = new AbortController();
    request.current.controller = controller;
    const trimmed = query.trim();
    setState((previous) => ({
      ...(previous.ownerId === ownerId ? previous : empty(ownerId)),
      query,
      items: pageNumber > 1 ? previous.items : [],
      page: pageNumber > 1 ? previous.page : 0,
      total: pageNumber > 1 ? previous.total : 0,
      phase: trimmed ? "loading" : "idle",
      failedPage: 1,
    }));
    if (!trimmed) {
      request.current.controller = null;
      return;
    }
    const lookup = async () => {
      try {
        const page = await api.search(trimmed, pageNumber, controller.signal);
        if (
          controller.signal.aborted ||
          generation !== request.current.generation ||
          currentMemberId() !== ownerId
        )
          return;
        setState((previous) => {
          const byId = new Map(
            (pageNumber > 1 ? previous.items : []).map((member) => [
              member.id,
              member,
            ]),
          );
          for (const member of page.items)
            if (member.id !== ownerId) byId.set(member.id, member);
          return {
            ...previous,
            items: [...byId.values()],
            page: page.page,
            total: page.total,
            phase: "ready",
          };
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== request.current.generation ||
          currentMemberId() !== ownerId
        )
          return;
        if (
          error instanceof MemberLookupError &&
          (error.status === 401 || error.status === 403)
        ) {
          setState(empty(null));
          void authController.refresh();
        } else
          setState((previous) => ({
            ...previous,
            phase: "error",
            failedPage: pageNumber,
          }));
      } finally {
        if (generation === request.current.generation)
          request.current.controller = null;
      }
    };
    if (delay) {
      debounce.current = setTimeout(() => {
        debounce.current = null;
        void lookup();
      }, 300);
    } else return lookup();
  }

  const visible = ownerId !== null && state.ownerId === ownerId;
  const selected = visible ? state.selected : [];
  const items = visible
    ? state.items.filter(
        (member) =>
          member.id !== ownerId &&
          !selected.some((chosen) => chosen.id === member.id),
      )
    : [];
  return {
    query: visible ? state.query : "",
    selected,
    items,
    phase: visible ? state.phase : "idle",
    hasMore: visible && state.page * 20 < state.total,
    disabled: locked || !visible,
    setQuery: (query: string) => {
      void search(query, 1, true);
    },
    retry: () => {
      if (!request.current.controller)
        void search(state.query, state.failedPage);
    },
    loadMore: () => {
      if (state.page * 20 < state.total && !request.current.controller)
        void search(state.query, state.page + 1);
    },
    select: (id: string) => {
      const member = items.find((item) => item.id === id);
      if (locked || !visible || !member || currentMemberId() !== ownerId)
        return;
      invalidate();
      setState((previous) => ({
        ...previous,
        query: "",
        items: [],
        page: 0,
        total: 0,
        phase: "idle",
        selected: previous.selected.some((item) => item.id === id)
          ? previous.selected
          : [...previous.selected, member],
      }));
    },
    remove: (id: string) => {
      if (!locked && visible && currentMemberId() === ownerId)
        setState((previous) => ({
          ...previous,
          selected: previous.selected.filter((member) => member.id !== id),
        }));
    },
  };
}
