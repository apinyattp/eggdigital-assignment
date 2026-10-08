import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm as Form } from "./LoginForm";
const LoginForm = (props: Partial<React.ComponentProps<typeof Form>>) => (
  <Form onGoogle={() => undefined} onPassword={() => undefined} {...props} />
);

describe("Login presentation", () => {
  it("explains unavailable Google without a retry and keeps password login usable", async () => {
    const user = userEvent.setup();
    const onGoogle = vi.fn();
    const onPassword = vi.fn();
    render(
      <LoginForm
        googleAvailable={false}
        onGoogle={onGoogle}
        onPassword={onPassword}
      />,
    );
    const google = screen.getByRole("button", { name: "Sign in with Google" });
    expect(google).toBeDisabled();
    expect(google).toHaveAccessibleDescription(/Google sign-in is not enabled/);
    await user.click(google);
    expect(onGoogle).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "person@example.test",
    );
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "synthetic-only",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));
    expect(onPassword).toHaveBeenCalledExactlyOnceWith(
      "person@example.test",
      "synthetic-only",
    );
  });
  it("starts without prototype credentials and keeps labels accessible", () => {
    render(<LoginForm />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toHaveAttribute("type", "button");
  });

  it("shows and hides a typed password without changing its value or submitting", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const input = screen.getByLabelText("Password", { exact: true });
    const submitted = vi.fn();
    input.closest("form")!.addEventListener("submit", submitted);
    await user.type(input, "  synthetic password  ");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("  synthetic password  ");
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    expect(hide).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("  synthetic password  ");
    expect(submitted).not.toHaveBeenCalled();
  });

  it("supports keyboard order and Space activation of the visibility control", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    for (const target of [
      screen.getByRole("button", { name: "Sign in with Google" }),
      screen.getByRole("textbox", { name: "Email" }),
      screen.getByLabelText("Password", { exact: true }),
      screen.getByRole("button", { name: "Show password" }),
    ]) {
      await user.tab();
      expect(target).toHaveFocus();
    }
    await user.keyboard(" ");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Login" })).toHaveFocus();
  });

  it("submits exact password and Google intent without native form navigation", async () => {
    const user = userEvent.setup();
    const onPassword = vi.fn();
    const onGoogle = vi.fn();
    render(<LoginForm onPassword={onPassword} onGoogle={onGoogle} />);
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "person@example.test",
    );
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "  synthetic-only  ",
    );
    await user.click(screen.getByRole("button", { name: "Login" }));
    await user.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );
    expect(onPassword).toHaveBeenCalledExactlyOnceWith(
      "person@example.test",
      "  synthetic-only  ",
    );
    expect(onGoogle).toHaveBeenCalledTimes(1);
  });

  it("locks both authentication submits while pending and exposes busy state", async () => {
    const user = userEvent.setup();
    const onPassword = vi.fn();
    const onGoogle = vi.fn();
    render(
      <LoginForm
        pending="password"
        onPassword={onPassword}
        onGoogle={onGoogle}
      />,
    );
    expect(screen.getByRole("button", { name: /Login/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Login/ }));
    await user.click(
      screen.getByRole("button", { name: "Sign in with Google" }),
    );
    expect(onPassword).not.toHaveBeenCalled();
    expect(onGoogle).not.toHaveBeenCalled();
  });

  it("renders a supplied error as text and preserves entered fields when it clears", async () => {
    const user = userEvent.setup();
    const view = render(<LoginForm />);
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "person@example.test",
    );
    await user.type(
      screen.getByLabelText("Password", { exact: true }),
      "synthetic-only",
    );
    view.rerender(
      <LoginForm errorMessage={"<script>unsafe</script> กรุณาลองใหม่"} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "<script>unsafe</script> กรุณาลองใหม่",
    );
    expect(screen.getByRole("alert").querySelector("script")).toBeNull();
    view.rerender(<LoginForm />);
    expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue(
      "person@example.test",
    );
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue(
      "synthetic-only",
    );
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });
});
