"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { authErrorMessage } from "@/api/auth/authErrorMessages";
import { useDashboardPage } from "@/hooks/useDashboardPage";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import { APP_ROUTES } from "@/constants/routes";
import styles from "../dashboard.module.css";
import { MeetingDashboard } from "./MeetingDashboard";

export function AuthLanding({
  initialDate,
  invalidDate = false,
}: {
  initialDate?: string;
  invalidDate?: boolean;
}) {
  const auth = useDashboardPage();
  const checkedListAccess = useRef(false);
  const refreshSession = auth.refresh;
  const onAccessError = useCallback(() => {
    // One automatic identity recheck per mounted dashboard, so a persistent
    // list denial cannot cause an L4 -> list -> L4 request loop.
    if (!checkedListAccess.current) {
      checkedListAccess.current = true;
      void refreshSession();
    }
  }, [refreshSession]);
  const session =
    auth.usableSession?.user.membership === "member"
      ? auth.usableSession
      : null;
  if (session) {
    return (
      <main className={styles.shell}>
        {invalidDate ? (
          <section role="alert">
            <h1>Invalid date</h1>
            <p>Enter a date in YYYY-MM-DD format.</p>
            <Link href="/dashboard">Choose another date</Link>
          </section>
        ) : (
          <MeetingDashboard
            key={`${session.user.membership}:${session.user.id ?? session.user.email}`}
            user={session.user}
            initialDate={initialDate}
            onAccessError={onAccessError}
          />
        )}
      </main>
    );
  }
  return (
    <main className={styles.shell}>
      {(!auth.checked || auth.status === "checking") && (
        <p role="status">Checking your account…</p>
      )}
      {auth.checked &&
        auth.status === "authenticated" &&
        auth.session?.user.membership !== "member" && (
          <section role="alert">
            <p>Unable to verify your access to these meetings.</p>
            <Link href="/login">Back to login</Link>
            <Button
              type="button"
              onClick={() => {
                void auth.logout();
              }}
            >
              Logout
            </Button>
          </section>
        )}
      {!!auth.error && (
        <ErrorMessage role="alert">{authErrorMessage(auth.error)}</ErrorMessage>
      )}
      {auth.pending === "logout" && <p role="status">Signing out…</p>}
      {(session || auth.logoutRequired) && (
        <Button
          type="button"
          disabled={!!auth.pending}
          onClick={() => {
            void auth.logout();
          }}
        >
          {auth.logoutRequired && !auth.pending
            ? "Retry sign-out"
            : "Logout"}
        </Button>
      )}
      {auth.status === "error" && !auth.logoutRequired && (
        <>
          <Button
            type="button"
            onClick={() => {
              void auth.refresh();
            }}
          >
            Check account again
          </Button>
          <Link className={styles.backLink} href={APP_ROUTES.login}>
            Back to login
          </Link>
        </>
      )}
    </main>
  );
}
