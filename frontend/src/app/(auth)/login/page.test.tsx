import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./_components/LoginEntry", () => ({
  LoginEntry: ({ googleAvailable }: { googleAvailable: boolean }) => (
    <div data-testid="availability">{String(googleAvailable)}</div>
  ),
}));
import LoginPage, { dynamic } from "./page";
afterEach(() => vi.unstubAllEnvs());
describe("Login runtime provider availability", () => {
  it.each([
    { id: "", secret: "", available: false },
    { id: "synthetic-client", secret: "", available: false },
    { id: "", secret: "synthetic-secret", available: false },
    { id: "synthetic-client", secret: "synthetic-secret", available: true },
  ])(
    "passes only availability for $available configuration",
    ({ id, secret, available }) => {
      vi.stubEnv("GOOGLE_CLIENT_ID", id);
      vi.stubEnv("GOOGLE_CLIENT_SECRET", secret);
      render(<LoginPage />);
      expect(dynamic).toBe("force-dynamic");
      expect(screen.getByTestId("availability")).toHaveTextContent(
        String(available),
      );
      expect(screen.queryByText("synthetic-client")).not.toBeInTheDocument();
      expect(screen.queryByText("synthetic-secret")).not.toBeInTheDocument();
    },
  );
});
