"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { APP_ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { authController } from "@/hooks/authController";
import { WorkspaceShell } from "./_components/WorkspaceShell";

export default function MainLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const confirmedAnonymous =
    auth.status === "anonymous" && !auth.pending && !auth.logoutRequired;
  useEffect(() => {
    if (confirmedAnonymous) {
      router.replace(APP_ROUTES.login);
    }
  }, [confirmedAnonymous, router]);
  if (confirmedAnonymous) {
    return null;
  }
  return (
    <WorkspaceShell
      user={auth.session?.user ?? null}
      activePage={pathname === "/meetings/new" ? "new" : "meetings"}
      onLogout={() => {
        void authController.logout();
      }}
    >
      {children}
    </WorkspaceShell>
  );
}
