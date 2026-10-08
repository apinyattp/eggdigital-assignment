"use client";

import { authErrorMessage } from "@/api/auth/authErrorMessages";
import { AuthError } from "@/api/auth/authError";
import { useLoginPage } from "@/hooks/useLoginPage";
import { LoginForm } from "./LoginForm";
import { Button } from "@/components/ui/Button";
import styles from "../login.module.css";

export function LoginEntry({
  googleAvailable = true,
}: {
  googleAvailable?: boolean;
}) {
  const auth = useLoginPage();
  if (auth.logoutRequired)
    return (
      <section className={styles.card}>
        <p role="status">
          {auth.pending
            ? "Signing out…"
            : "Sign-out has not completed. Please try again."}
        </p>
        {!!auth.error && <p role="alert">{authErrorMessage(auth.error)}</p>}
        <Button
          type="button"
          disabled={!!auth.pending}
          onClick={() => {
            void auth.logout();
          }}
        >
          Retry sign-out
        </Button>
      </section>
    );
  return (
    <div className={styles.formContainer}>
      <LoginForm
        googleAvailable={googleAvailable}
        errorMessage={
          !googleAvailable &&
          auth.error instanceof AuthError &&
          auth.error.code === "GOOGLE_AUTH_UNAVAILABLE"
            ? undefined
            : auth.error
              ? authErrorMessage(auth.error)
              : undefined
        }
        blocked={
          !auth.checked ||
          auth.pending === "complete" ||
          auth.status === "checking" ||
          auth.status === "redirecting" ||
          auth.status === "authenticated"
        }
        pending={
          auth.pending === "password" || auth.pending === "google-start"
            ? auth.pending
            : null
        }
        onPassword={(email, password) => {
          void auth.login(email, password);
        }}
        onGoogle={() => {
          if (googleAvailable) {
            void auth.googleStart();
          }
        }}
      />
      {auth.pending === "complete" && (
        <div role="status">
          <p>Completing sign-in…</p>
          <Button
            type="button"
            onClick={() => {
              void auth.logout();
            }}
          >
            Cancel and sign out
          </Button>
        </div>
      )}
      {auth.status === "checking" && (
        <p className={styles.sessionStatus} role="status">
          Checking your account…
        </p>
      )}
      {auth.status === "error" && (
        <button
          className={styles.retry}
          type="button"
          onClick={() => {
            void auth.refresh();
          }}
        >
          Check account again
        </button>
      )}
    </div>
  );
}
