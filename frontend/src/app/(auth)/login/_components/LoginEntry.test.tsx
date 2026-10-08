import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/hooks/authController";
import { AuthError } from "@/api/auth/authError";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  callbackError: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  login: vi.fn(),
  googleStart: vi.fn(),
  state: {
    status: "checking",
    session: null,
    pending: null,
    error: null,
    logoutRequired: false,
    checked: true,
  } as AuthSnapshot & { checked: boolean },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.state,
  useCurrentIdentity: () => mocks.state,
}));
vi.mock("@/hooks/authController", () => ({
  authController: {
    callbackError: mocks.callbackError,
    refresh: mocks.refresh,
    logout: mocks.logout,
    login: mocks.login,
    googleStart: mocks.googleStart,
    getSnapshot: () => mocks.state,
  },
}));

beforeEach(() => {
  mocks.state = {
    status: "checking",
    session: null,
    pending: null,
    error: null,
    logoutRequired: false,
    checked: true,
  };
  mocks.logout.mockResolvedValue(undefined);
  window.history.replaceState({}, "", "/");
});

import { LoginEntry } from "./LoginEntry";

describe("Login current identity redirect", () => {
  it("replaces an unavailable-provider retry error with configuration availability guidance", () => {
    mocks.state = {
      ...mocks.state,
      status: "anonymous",
      error: new AuthError("GOOGLE_AUTH_UNAVAILABLE", 503),
    };
    render(<LoginEntry googleAvailable={false} />);
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Login" })).toBeEnabled();
    expect(
      screen.getByText(/Google sign-in is not enabled for this system./),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "Unable to connect to Google right now. Please try again.",
      ),
    ).not.toBeInTheDocument();
  });
  const session = {
    user: {
      id: "member",
      displayName: "Member",
      email: "member@example.test",
      membership: "member" as const,
    },
    expiresAt: "2099-01-01T00:00:00Z",
  };
  it("redirects an already verified Login visit to dashboard", () => {
    mocks.state = { ...mocks.state, status: "authenticated", session };
    render(<LoginEntry />);
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
    expect(screen.getByRole("button", { name: "Login" })).toBeDisabled();
  });
});
