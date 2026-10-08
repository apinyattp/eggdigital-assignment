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
  it.each([
    ["button", "pointerdown"],
    ["span", "pointerdown"],
    ["svg", "pointerdown"],
    ["button", "pointerup"],
    ["span", "pointerup"],
    ["svg", "pointerup"],
  ])(
    "keeps the account menu open through an inside touch blur on %s after %s",
    async (target, blurAfter) => {
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
      if (blurAfter === "pointerup")
        fireEvent.pointerUp(touched, { pointerType: "touch" });
      fireEvent.blur(button, { relatedTarget: null });
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      if (blurAfter === "pointerdown")
        fireEvent.pointerUp(touched, { pointerType: "touch" });
      fireEvent.click(touched);
      expect(onLogout).toHaveBeenCalledOnce();
    },
  );
  it.each(["click", "cancel", "keyboard", "outside release", "window blur"])(
    "clears the touch guard after %s so focus can leave the account menu",
    async (completion) => {
      const events = userEvent.setup();
      const onLogout = vi.fn();
      render(
        <WorkspaceShell user={user} onLogout={onLogout}>
          <button>Outside</button>
        </WorkspaceShell>,
      );
      const toggle = screen.getByRole("button", { name: "Account" });
      await events.click(toggle);
      const button = screen.getByRole("button", { name: "Logout" });
      fireEvent.pointerDown(button, { pointerType: "touch" });
      fireEvent.pointerUp(button, { pointerType: "touch" });
      if (completion === "click") fireEvent.click(button);
      if (completion === "cancel") fireEvent.pointerCancel(button);
      if (completion === "keyboard") fireEvent.keyDown(button, { key: "Tab" });
      if (completion === "outside release")
        fireEvent.pointerUp(screen.getByRole("button", { name: "Outside" }));
      if (completion === "window blur") fireEvent.blur(window);
      fireEvent.blur(button, { relatedTarget: null });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(onLogout).toHaveBeenCalledTimes(completion === "click" ? 1 : 0);
    },
  );
  it("dismisses when focus moves to a known outside target during a touch", async () => {
    const events = userEvent.setup();
    render(
      <WorkspaceShell user={user} onLogout={vi.fn()}>
        <button>Outside</button>
      </WorkspaceShell>,
    );
    const toggle = screen.getByRole("button", { name: "Account" });
    await events.click(toggle);
    const button = screen.getByRole("button", { name: "Logout" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.blur(button, {
      relatedTarget: screen.getByRole("button", { name: "Outside" }),
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
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
