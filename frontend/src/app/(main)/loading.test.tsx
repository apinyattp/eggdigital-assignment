import { Suspense, use, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./_components/WorkspaceShell";
import Loading from "./loading";
import WorkspaceError from "./error";

const user = {
  id: "owner",
  membership: "member" as const,
  email: "owner@example.test",
  displayName: "Owner",
};
function pendingPage() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Page({ ready }: { ready: Promise<string> }) {
  return (
    <main>
      <h1>{use(ready)}</h1>
    </main>
  );
}
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});
describe("workspace route loading and recovery", () => {
  it("keeps the shell interactive while content suspends and removes loading as soon as content resolves", async () => {
    const pending = pendingPage();
    const logout = vi.fn();
    await act(async () => {
      render(
        <WorkspaceShell user={user} onLogout={logout}>
          <Suspense fallback={<Loading />}>
            <Page ready={pending.promise} />
          </Suspense>
        </WorkspaceShell>,
      );
    });
    const header = screen.getByRole("banner");
    const navigation = screen.getByRole("navigation", {
      name: "Workspace navigation",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading page…");
    expect(
      screen.getByRole("status").closest("[data-workspace-content]"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Logout" }));
    expect(logout).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve("Meeting details");
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Meeting details" }),
    ).toBeVisible();
    expect(screen.getByRole("banner")).toBe(header);
    expect(
      screen.getByRole("navigation", { name: "Workspace navigation" }),
    ).toBe(navigation);
  });
  it("does not leave loading or stale content behind when a pending navigation is replaced", async () => {
    const pending = pendingPage();
    function Workspace() {
      const [destination, setDestination] = useState("pending");
      return (
        <WorkspaceShell user={user} onLogout={vi.fn()}>
          <button onClick={() => setDestination("ready")}>
            Choose another page
          </button>
          <Suspense fallback={<Loading />}>
            {destination === "pending" ? (
              <Page ready={pending.promise} />
            ) : (
              <main>New meeting</main>
            )}
          </Suspense>
        </WorkspaceShell>
      );
    }
    await act(async () => {
      render(<Workspace />);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Choose another page" }),
      );
    });
    expect(screen.getByText("New meeting")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => {
      pending.resolve("Abandoned meeting");
    });
    expect(screen.queryByText("Abandoned meeting")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("renders ready content without a loading state", () => {
    render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        <Suspense fallback={<Loading />}>
          <main>Ready page</main>
        </Suspense>
      </WorkspaceShell>,
    );
    expect(screen.getByText("Ready page")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("offers error recovery inside the shell without displaying exception details", () => {
    const reset = vi.fn();
    render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        <WorkspaceError reset={reset} />
      </WorkspaceShell>,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to load this page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "Back to meetings" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(
      screen.getByRole("navigation", { name: "Workspace navigation" }),
    ).toBeInTheDocument();
  });
});
