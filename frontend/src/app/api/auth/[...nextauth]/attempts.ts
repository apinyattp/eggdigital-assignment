import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { BridgeError } from "@/api/auth/authError";
export { BridgeError } from "@/api/auth/authError";

export type AttemptStatus =
  | "pending"
  | "exchanging"
  | "verified"
  | "completing"
  | "completed"
  | "cancelled"
  | "failed";
export type Attempt = {
  id: string;
  bindingHash: string;
  createdAt: number;
  expiresAt: number;
  status: AttemptStatus;
  googleStateHash?: string;
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function createAttemptRegistry(
  now: () => number = Date.now,
  capacity = 1000,
) {
  const entries = new Map<string, Attempt>();
  const googleStates = new Map<string, Attempt>();
  function prune() {
    for (const [key, entry] of entries)
      if (entry.expiresAt <= now()) entries.delete(key);
    for (const [key, entry] of googleStates)
      if (entry.expiresAt <= now()) googleStates.delete(key);
  }
  function lookup(binding: string | undefined) {
    return binding ? entries.get(digest(binding)) : undefined;
  }
  function assert(entry: Attempt, allowed: AttemptStatus[]) {
    if (entries.get(entry.bindingHash) !== entry || entry.expiresAt <= now())
      throw new BridgeError("UNAUTHENTICATED");
    if (entry.status === "cancelled")
      throw new BridgeError("AUTH_ATTEMPT_CANCELLED", 409);
    if (
      entry.status === "completed" ||
      (entry.status === "completing" && !allowed.includes("completing"))
    )
      throw new BridgeError("AUTH_ATTEMPT_USED", 409);
    if (!allowed.includes(entry.status))
      throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
    return entry;
  }
  return {
    start(previousBinding: string | undefined) {
      prune();
      if (entries.size >= capacity)
        throw new BridgeError("AUTH_UNAVAILABLE", 503);
      const previous = lookup(previousBinding);
      if (previous && previous.status !== "completed")
        previous.status = "cancelled";
      const binding = randomBytes(32).toString("base64url");
      const entry: Attempt = {
        id: randomBytes(32).toString("base64url"),
        bindingHash: digest(binding),
        createdAt: now(),
        expiresAt: now() + 300_000,
        status: "pending",
      };
      entries.set(entry.bindingHash, entry);
      return { binding, entry };
    },
    bound(binding: string | undefined, id?: string) {
      const entry = lookup(binding);
      if (!entry || entry.expiresAt <= now())
        throw new BridgeError("UNAUTHENTICATED");
      if (id !== undefined && entry.id !== id)
        throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
      return entry;
    },
    assert,
    bindGoogleState(entry: Attempt, state: string) {
      assert(entry, ["pending"]);
      const key = digest(state);
      if (!state || entry.googleStateHash || googleStates.has(key))
        throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
      entry.googleStateHash = key;
      googleStates.set(key, entry);
    },
    claimGoogle(state: string, binding: string | undefined) {
      const entry = googleStates.get(digest(state));
      if (!state || !entry || lookup(binding) !== entry)
        throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
      assert(entry, ["pending"]);
      entry.status = "exchanging";
      return entry;
    },
    claim(entry: Attempt, from: AttemptStatus, to: AttemptStatus) {
      assert(entry, [from]);
      entry.status = to;
      return entry;
    },
    cancel(binding: string | undefined) {
      const entry = lookup(binding);
      if (
        entry &&
        ["pending", "exchanging", "verified", "completing"].includes(
          entry.status,
        )
      )
        entry.status = "cancelled";
    },
    fail(entry: Attempt) {
      if (
        entries.get(entry.bindingHash) === entry &&
        !["cancelled", "completed"].includes(entry.status)
      )
        entry.status = "failed";
    },
  };
}

// One process-local registry shared by route bundles; never a global current request or token.
const runtime = globalThis as typeof globalThis & {
  meetingManagerAttempts?: ReturnType<typeof createAttemptRegistry>;
};
export const attempts = (runtime.meetingManagerAttempts ??=
  createAttemptRegistry());
