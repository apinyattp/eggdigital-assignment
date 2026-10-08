import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./WorkspaceShell";
const user = {
  id: "member",
  membership: "member" as const,
  email: "member@example.test",
  displayName: "Member",
};
let resize: () => void;
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: true,
    addEventListener: (_: string, callback: () => void) => {
      resize = callback;
    },
    removeEventListener: vi.fn(),
  });
  document.body.style.overflow = "";
});
describe("approved common Member navigation", () => {
  it("gives all authenticated Members the same Meetings and creation entries", () => {
    const { rerender } = render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        Content
      </WorkspaceShell>,
    );
    const nav = screen.getByRole("navigation", {
      name: "Workspace navigation",
    });
    expect(within(nav).getAllByRole("link")).toHaveLength(2);
    expect(within(nav).getByRole("link", { name: "Meetings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    rerender(
      <WorkspaceShell
        user={{ ...user, id: "member", membership: "member" }}
        onLogout={vi.fn()}
      >
        Content
      </WorkspaceShell>,
    );
    expect(
      within(nav).getByRole("link", { name: "Add New Meeting" }),
    ).toHaveAttribute("href", "/meetings/new");
  });
  it("closes narrow navigation on Escape and resize without discarding child draft", async () => {
    const events = userEvent.setup();
    render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        <input aria-label="draft" defaultValue="preserve" />
      </WorkspaceShell>,
    );
    await events.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(document.querySelector("[data-workspace-content]")).toHaveAttribute(
      "inert",
    );
    expect(document.body.style.overflow).toBe("hidden");
    await events.keyboard("{Escape}");
    expect(
      screen.getByRole("button", { name: "Open navigation" }),
    ).toHaveFocus();
    expect(
      document.querySelector("[data-workspace-content]"),
    ).not.toHaveAttribute("inert");
    await events.click(screen.getByRole("button", { name: "Open navigation" }));
    act(() => resize());
    expect(document.body.style.overflow).toBe("");
    expect(screen.getByRole("textbox", { name: "draft" })).toHaveValue(
      "preserve",
    );
  });
  it("shows the same real Logout action from the account menu", async () => {
    const events = userEvent.setup();
    const onLogout = vi.fn();
    render(
      <WorkspaceShell user={user} onLogout={onLogout}>
        Content
      </WorkspaceShell>,
    );
    await events.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByRole("button", { name: "Logout" })).toHaveFocus();
    await events.click(screen.getByRole("button", { name: "Logout" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
  it.each(["button", "span", "svg"])(
    "keeps the account menu open through an inside touch blur on %s",
    async (target) => {
      const events = userEvent.setup();
      const onLogout = vi.fn();
      render(
        <WorkspaceShell user={user} onLogout={onLogout}>
          Content
        </WorkspaceShell>,
      );
      const toggle = screen.getByRole("button", { name: "Account" });
      await events.click(toggle);
      const button = screen.getByRole("button", { name: "Logout" });
      const touched =
        target === "button" ? button : button.querySelector(target)!;
      fireEvent.pointerDown(touched, { pointerType: "touch" });
      fireEvent.blur(button, { relatedTarget: null });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      fireEvent.pointerUp(touched, { pointerType: "touch" });
      fireEvent.click(touched);
      expect(onLogout).toHaveBeenCalledOnce();
    },
  );
  it("still dismisses on outside pointers, Tab, Escape and blur without a pointer", async () => {
    const events = userEvent.setup();
    render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        <button>Outside</button>
      </WorkspaceShell>,
    );
    const toggle = screen.getByRole("button", { name: "Account" });
    await events.click(toggle);
    await events.click(screen.getByRole("button", { name: "Outside" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await events.click(toggle);
    await events.tab();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await events.click(toggle);
    await events.keyboard("{Escape}");
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await events.click(toggle);
    fireEvent.blur(screen.getByRole("button", { name: "Logout" }), {
      relatedTarget: null,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
