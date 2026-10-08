"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { authController, initialAuthSnapshot } from "./authController";

export function useAuth() {
  return useSyncExternalStore(
    authController.subscribe,
    authController.getSnapshot,
    () => initialAuthSnapshot,
  );
}

export function useCurrentIdentity(initialize = authController.refresh) {
  const auth = useAuth();
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void initialize().then(() => {
      if (active) setChecked(true);
    });
    const recheck = () => {
      // Revalidate protected identity on return without interrupting an anonymous form.
      if (authController.getSnapshot().status === "authenticated")
        void authController.refresh();
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    return () => {
      active = false;
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", recheck);
    };
  }, [initialize]);
  useEffect(() => {
    if (!auth.session) return;
    const delay = Math.max(
      1000,
      Math.min(Date.parse(auth.session.expiresAt) - Date.now(), 2_147_483_647),
    );
    const timer = window.setTimeout(() => {
      void authController.refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [auth.session]);
  const usableSession =
    checked &&
    auth.status === "authenticated" &&
    !auth.pending &&
    !auth.logoutRequired
      ? auth.session
      : null;
  return { ...auth, checked, usableSession };
}
