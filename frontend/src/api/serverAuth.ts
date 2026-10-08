import "server-only";
import { randomUUID } from "node:crypto";
import { securityConfig } from "@/config/security.server";
import { BridgeError } from "./auth/authError";
import type { Session } from "./auth/authApi";

export type IssuedIdentity = Session & { accessToken: string };
const safeCodes = new Set([
  "INVALID_CREDENTIALS",
  "VALIDATION_ERROR",
  "CANDIDATE_DENIED",
  "MEMBER_NOT_FOUND",
  "EMAIL_OWNERSHIP_UNVERIFIED",
  "GOOGLE_IDENTITY_INVALID",
  "GOOGLE_AUTH_UNAVAILABLE",
  "DEPENDENCY_UNAVAILABLE",
  "TOO_MANY_REQUESTS",
]);

export async function issueIdentity(
  input:
    | { method: "password"; email: string; password: string }
    | { method: "google"; idToken: string },
): Promise<IssuedIdentity> {
  const config = securityConfig();
  let response: Response;
  try {
    response = await fetch(`${config.internalUrl}/internal/auth/issue`, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Auth-Service-Key": config.serviceKey,
        "X-Request-Id": randomUUID(),
      },
      body: JSON.stringify(
        input.method === "password"
          ? { ...input, email: input.email.trim().toLowerCase() }
          : input,
      ),
    });
  } catch {
    throw new BridgeError("DEPENDENCY_UNAVAILABLE", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new BridgeError(
      safeCodes.has(data?.error?.code) ? data.error.code : "AUTH_UNAVAILABLE",
      [400, 401, 403, 404, 429, 503].includes(response.status)
        ? response.status
        : 503,
    );
  const expiry =
    typeof data?.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  const validUser =
    data?.user &&
    typeof data.user.displayName === "string" &&
    typeof data.user.email === "string" &&
    data.user.membership === "member" &&
    typeof data.user.id === "string";
  if (
    typeof data?.accessToken !== "string" ||
    !data.accessToken ||
    /[\s;,]/.test(data.accessToken) ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now() ||
    expiry > Date.now() + config.ttl * 1000 ||
    !validUser
  )
    throw new BridgeError("AUTH_UNAVAILABLE", 503);
  return {
    accessToken: data.accessToken,
    expiresAt: data.expiresAt,
    user: {
      id: data.user.id,
      displayName: data.user.displayName,
      email: data.user.email,
      membership: data.user.membership,
    },
  };
}
