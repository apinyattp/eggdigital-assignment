// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAttemptRegistry } from "./attempts";

describe("attempt identity, one-use and immutable Google correlation (TEST-MM-050/054/055)", () => {
  it("allows more than ten starts without a quota and retains bounded terminal entries", () => {
    let time = 0;
    const registry = createAttemptRegistry(() => time, 25);
    let binding: string | undefined;
    for (let n = 0; n < 25; n++) binding = registry.start(binding).binding;
    expect(() => registry.start(binding)).toThrowError("AUTH_UNAVAILABLE");
    expect(() => registry.cancel(binding)).not.toThrow();
    time = 300_000;
    expect(() => registry.start(binding)).not.toThrow();
  });
  it("keeps raw binding/credentials/tokens out of entries and cancels the captured old object", () => {
    const registry = createAttemptRegistry();
    const first = registry.start(undefined);
    registry.claim(first.entry, "pending", "exchanging");
    const second = registry.start(first.binding);
    expect(first.entry.status).toBe("cancelled");
    expect(JSON.stringify(first.entry)).not.toContain(first.binding);
    expect(Object.keys(first.entry).sort()).toEqual([
      "bindingHash",
      "createdAt",
      "expiresAt",
      "id",
      "status",
    ]);
    expect(() => registry.assert(first.entry, ["exchanging"])).toThrowError(
      "AUTH_ATTEMPT_CANCELLED",
    );
    expect(second.entry.status).toBe("pending");
  });
  it.each(["pending", "verified", "completed"] as const)(
    "rejects delayed Google A with current Password B %s without mutating B",
    (status) => {
      const registry = createAttemptRegistry();
      const a = registry.start(undefined);
      registry.bindGoogleState(a.entry, "state-a");
      registry.cancel(a.binding);
      const b = registry.start(a.binding);
      b.entry.status = status;
      expect(() => registry.claimGoogle("state-a", b.binding)).toThrowError(
        "AUTH_ATTEMPT_INVALID",
      );
      expect(b.entry.status).toBe(status);
    },
  );
  it("claims an original Google callback once, never retargets state and rejects missing/restarted index", () => {
    const registry = createAttemptRegistry();
    const a = registry.start(undefined);
    registry.bindGoogleState(a.entry, "state-a");
    expect(() => registry.bindGoogleState(a.entry, "another-state")).toThrow();
    expect(registry.claimGoogle("state-a", a.binding)).toBe(a.entry);
    expect(() => registry.claimGoogle("state-a", a.binding)).toThrow();
    const b = registry.start(a.binding);
    registry.bindGoogleState(b.entry, "state-b");
    expect(() => registry.claimGoogle("state-a", b.binding)).toThrow();
    expect(() =>
      createAttemptRegistry().claimGoogle("state-b", b.binding),
    ).toThrow();
  });
  it("rejects a late captured entry at the strict attempt deadline", () => {
    let time = 0;
    const registry = createAttemptRegistry(() => time);
    const a = registry.start(undefined);
    registry.claim(a.entry, "pending", "exchanging");
    time = 300_000;
    expect(() =>
      registry.claim(a.entry, "exchanging", "verified"),
    ).toThrowError("UNAUTHENTICATED");
  });
});
