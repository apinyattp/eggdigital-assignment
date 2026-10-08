import Link from "next/link";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/api/auth/authError";
import type { AuthSnapshot } from "@/hooks/authController";

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
  useCurrentIdentity: () => ({
    ...mocks.state,
    usableSession:
      mocks.state.checked &&
      mocks.state.status === "authenticated" &&
      !mocks.state.pending &&
      !mocks.state.logoutRequired
        ? mocks.state.session
        : null,
  }),
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
vi.mock("./MeetingDashboard", () => ({
  MeetingDashboard: ({ user }: { user: { membership: string } }) => (
    <section aria-label="Meeting dashboard">
      {user.membership === "member" && (
        <Link href="/meetings/new">Add New Meeting</Link>
      )}
    </section>
  ),
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
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

import { AuthLanding } from "./AuthLanding";

describe("current identity guards before meeting dashboard", () => {
  const session = {
    user: {
      id: "member",
      displayName: "<img src=x onerror=alert(1)>",
      email: "member@example.test",
      membership: "member" as const,
    },
    expiresAt: "2099-01-01T00:00:00Z",
  };
  it("does not expose cached identity before a direct dashboard check", () => {
    mocks.state = {
      ...mocks.state,
      status: "authenticated",
      session,
      checked: false,
    };
    render(<AuthLanding />);
    expect(screen.queryByText(session.user.email)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your account…",
    );
  });
  it("renders verified Member content inside the route-owned main", () => {
    mocks.state = { ...mocks.state, status: "authenticated", session };
    render(<AuthLanding />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Meeting dashboard" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
  it("rejects a stale non-Member session without mounting the workspace", () => {
    mocks.state = {
      ...mocks.state,
      status: "authenticated",
      session: {
        ...session,
        user: {
          ...session.user,
          id: null,
          membership: "guest" as unknown as "member",
        },
      },
    };
    render(<AuthLanding />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to verify your access to these meetings.",
    );
    expect(
      screen.queryByRole("navigation", { name: "Workspace navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Meeting dashboard" }),
    ).not.toBeInTheDocument();
  });
  it("shows Add only to an authenticated Member", () => {
    mocks.state = {
      ...mocks.state,
      status: "authenticated",
      session: {
        ...session,
        user: { ...session.user, id: "owner", membership: "member" },
      },
    };
    render(<AuthLanding />);
    expect(
      screen.getByRole("link", { name: "Add New Meeting" }),
    ).toHaveAttribute("href", "/meetings/new");
  });
  it("does not silently replace an invalid URL date or load meetings", () => {
    mocks.state = { ...mocks.state, status: "authenticated", session };
    render(<AuthLanding initialDate="2026-10-08" invalidDate />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid date");
    expect(
      screen.queryByRole("region", { name: "Meeting dashboard" }),
    ).not.toBeInTheDocument();
  });
  it("redirects anonymous direct access to Login", () => {
    mocks.state.status = "anonymous";
    render(<AuthLanding />);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
  it.each([403, 503])(
    "shows current-session error %s without previous identity and allows retry",
    async (status) => {
      mocks.state = {
        ...mocks.state,
        status: "error",
        session,
        error: new AuthError(
          status === 403 ? "CANDIDATE_DENIED" : "DEPENDENCY_UNAVAILABLE",
          status,
        ),
      };
      render(<AuthLanding />);
      expect(screen.queryByText(session.user.email)).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();
      expect(
        screen.getByRole("link", { name: "Back to login" }),
      ).toHaveAttribute("href", "/login");
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Check account again" }));
      expect(mocks.refresh).toHaveBeenCalledTimes(1);
    },
  );
});
