"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { APP_ROUTES } from "@/constants/routes";
import { authController } from "./authController";
import { useCurrentIdentity } from "./useAuth";

export function useDashboardPage() {
  const auth = useCurrentIdentity();
  const router = useRouter();
  useEffect(() => {
    if (
      auth.checked &&
      auth.status === "anonymous" &&
      !auth.pending &&
      !auth.logoutRequired
    )
      router.replace(APP_ROUTES.login);
  }, [auth.checked, auth.status, auth.pending, auth.logoutRequired, router]);
  return {
    ...auth,
    logout: authController.logout,
    refresh: authController.refresh,
  };
}
