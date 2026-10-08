import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSnapshot } from "@/hooks/authController";
const mock = vi.hoisted(() => ({
  snapshot: {} as AuthSnapshot,
  pathname: "/meetings/example",
  replace: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mock.pathname,
  useRouter: () => ({ replace: mock.replace }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mock.snapshot }));
vi.mock("@/hooks/authController", () => ({
  authController: { logout: mock.logout },
}));
vi.mock("./_components/WorkspaceShell", () => ({
  WorkspaceShell: ({
    children,
    onLogout,
  }: {
    children: ReactNode;
    onLogout: () => void;
  }) => (
    <div data-testid="workspace-shell">
      <button onClick={onLogout}>Logout</button>
      {children}
    </div>
  ),
}));
import MainLayout from "./layout";
function authenticated(): AuthSnapshot {
  return {
    status: "authenticated",
    session: {
      user: {
        id: "owner",
        membership: "member",
        email: "owner@example.test",
        displayName: "Owner",
      },
      expiresAt: "2099-01-01T00:00:00Z",
    },
    pending: null,
    logoutRequired: false,
    error: null,
  };
}
const page = (
  <MainLayout>
    <p>Protected child</p>
  </MainLayout>
);
beforeEach(() => {
  mock.snapshot = authenticated();
  mock.pathname = "/meetings/example";
  mock.replace.mockClear();
  mock.logout.mockClear();
});
describe("confirmed logout routing in the common protected layout", () => {
  it.each([
    "/dashboard",
    "/meetings/new",
    "/meetings/example",
    "/meetings/example/edit",
  ])(
    "redirects %s only after logout is confirmed and removes the stale shell",
    (pathname) => {
      mock.pathname = pathname;
      const { rerender } = render(page);
      fireEvent.click(screen.getByRole("button", { name: "Logout" }));
      expect(mock.logout).toHaveBeenCalledOnce();
      expect(mock.replace).not.toHaveBeenCalled();
      mock.snapshot = {
        ...authenticated(),
        status: "anonymous",
        session: null,
        pending: "logout",
        logoutRequired: true,
      };
      rerender(
        <MainLayout>
          <p>Protected child</p>
        </MainLayout>,
      );
      expect(mock.replace).not.toHaveBeenCalled();
      mock.snapshot = {
        ...mock.snapshot,
        pending: null,
        logoutRequired: false,
      };
      rerender(
        <MainLayout>
          <p>Protected child</p>
        </MainLayout>,
      );
      expect(mock.replace).toHaveBeenCalledWith("/login");
      expect(screen.queryByTestId("workspace-shell")).not.toBeInTheDocument();
    },
  );
  it("preserves the retry action without redirect after failed or unconfirmed logout", () => {
    mock.snapshot = {
      ...authenticated(),
      status: "error",
      session: null,
      error: new Error("Logout unavailable"),
      logoutRequired: true,
    };
    const { rerender } = render(page);
    expect(mock.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(mock.logout).toHaveBeenCalledOnce();
    mock.snapshot = { ...mock.snapshot, status: "anonymous", error: null };
    rerender(
      <MainLayout>
        <p>Protected child</p>
      </MainLayout>,
    );
    expect(mock.replace).not.toHaveBeenCalled();
  });
  it("does not redirect checking or unavailable identity", () => {
    mock.snapshot = { ...authenticated(), status: "checking", session: null };
    const { rerender } = render(page);
    expect(mock.replace).not.toHaveBeenCalled();
    mock.snapshot = {
      ...mock.snapshot,
      status: "error",
      error: new Error("Session unavailable"),
    };
    rerender(
      <MainLayout>
        <p>Protected child</p>
      </MainLayout>,
    );
    expect(mock.replace).not.toHaveBeenCalled();
  });
});
