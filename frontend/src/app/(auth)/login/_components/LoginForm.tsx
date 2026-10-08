"use client";

import Image from "next/image";
import { usePasswordVisibility } from "@/hooks/usePasswordVisibility";
import { Button } from "@/components/ui/Button";
import { ErrorMessage } from "@/components/ui/ErrorMessage";
import styles from "../login.module.css";

type LoginFormProps = {
  pending?: "password" | "google-start" | null;
  blocked?: boolean;
  googleAvailable?: boolean;
  onPassword: (email: string, password: string) => void;
  onGoogle: () => void;
  errorMessage?: string;
};

export function LoginForm({
  errorMessage,
  pending,
  blocked = false,
  googleAvailable = true,
  onPassword,
  onGoogle,
}: LoginFormProps) {
  const password = usePasswordVisibility();

  return (
    <section className={styles.card} aria-labelledby="login-title">
      <div className={styles.cardBrand}>
        <Image
          src="/assets/egg-digital.png"
          alt="EGG Digital"
          width={93}
          height={50}
          unoptimized
        />
      </div>
      <h2 id="login-title">Welcome to EGG Digital</h2>
      <p className={styles.cardIntro}>
        Prepare for every conversation
        <br />
        and manage interviews in one place.
      </p>
      <button
        className={styles.googleButton}
        type="button"
        disabled={!googleAvailable || blocked || !!pending}
        aria-describedby={!googleAvailable ? "google-unavailable" : undefined}
        aria-busy={pending === "google-start"}
        onClick={onGoogle}
      >
        <Image
          src="/assets/google-g.png"
          alt=""
          width={20}
          height={20}
          unoptimized
        />
        <span>Sign in with Google</span>
        {pending === "google-start" && (
          <i className={styles.spinner} aria-label="Connecting to Google" />
        )}
      </button>
      {!googleAvailable && (
        <p id="google-unavailable" className={styles.help}>
          Google sign-in is not enabled for this system.
          Use the email and password provided to you.
        </p>
      )}
      <div className={styles.divider}>
        <span>or sign in with email</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked || pending) return;
          const data = new FormData(event.currentTarget);
          onPassword(
            String(data.get("email") ?? ""),
            String(data.get("password") ?? ""),
          );
        }}
      >
        <div id="login-error" role="alert" aria-live="polite" tabIndex={-1}>
          {errorMessage && <ErrorMessage>{errorMessage}</ErrorMessage>}
        </div>
        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            required
            aria-describedby={errorMessage ? "login-error" : undefined}
            disabled={blocked || !!pending}
            type="email"
            autoComplete="username"
            placeholder="Enter your email"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <div className={styles.passwordInput}>
            <input
              id="password"
              name="password"
              required
              aria-describedby={errorMessage ? "login-error" : undefined}
              disabled={blocked || !!pending}
              type={password.visible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
            />
            <button
              className={styles.passwordToggle}
              type="button"
              aria-label={password.visible ? "Hide password" : "Show password"}
              aria-pressed={password.visible}
              aria-controls="password"
              onClick={password.toggle}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
        <Button
          type="submit"
          disabled={blocked || !!pending}
          aria-busy={pending === "password"}
        >
          Login
          {pending === "password" && (
            <i className={styles.spinner} aria-label="Signing in" />
          )}
        </Button>
      </form>
      <p className={styles.help}>
        Members can use their company accounts.
        {googleAvailable &&
          " · Sign in with Google to access meetings you are attending."}
      </p>
    </section>
  );
}
