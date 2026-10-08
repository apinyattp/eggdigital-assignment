"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { APP_ROUTES } from "@/constants/routes";
import { authController } from "./authController";
import { useCurrentIdentity } from "./useAuth";
import { AuthError } from "@/api/auth/authError";

function initializeLogin() {
  const url = new URL(window.location.href);
  const completion = url.searchParams.getAll("complete");
  const errors = [
    ...url.searchParams.getAll("authError"),
    ...url.searchParams.getAll("error"),
  ];
  if (completion.length || errors.length) {
    url.searchParams.delete("complete");
    url.searchParams.delete("authError");
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
    if (errors.length || completion.length !== 1 || completion[0] !== "1") {
      authController.callbackError(
        new AuthError(errors.length === 1 ? errors[0] : "AUTH_ATTEMPT_INVALID"),
      );
      return Promise.resolve();
    }
    return authController.complete();
  }
  return authController.refresh();
}

export function useLoginPage() {
  const initialization = useRef<Promise<void> | null>(null);
  const initialize = useCallback(
    () => (initialization.current ??= initializeLogin()),
    [],
  );
  const auth = useCurrentIdentity(initialize);
  const router = useRouter();
  useEffect(() => {
    if (auth.checked && auth.status === "authenticated" && !auth.pending)
      router.replace(APP_ROUTES.dashboard);
  }, [auth.checked, auth.status, auth.pending, router]);
  return {
    ...auth,
    login: authController.login,
    googleStart: authController.googleStart,
    logout: authController.logout,
    refresh: authController.refresh,
  };
}
