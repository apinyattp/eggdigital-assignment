import { publicConfig } from "@/config/public";
import { Membership, type MembershipValue } from "@/enums/membership";
import { AuthError } from "./authError";
import { getCsrfToken, signIn, signOut } from "next-auth/react";
export { AuthError } from "./authError";

export type Session = {
  user: {
    id: string | null;
    displayName: string;
    email: string;
    membership: MembershipValue;
  };
  expiresAt: string;
};

// Public endpoint configuration only. Cookies remain browser-managed and HttpOnly.
const baseUrl = publicConfig.apiBaseUrl;

async function request(path: string, body?: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body === undefined
          ? {}
          : {
              "Content-Type": "application/json",
              "X-Requested-With": "MeetingManager",
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AuthError("NETWORK_ERROR");
  }
  if (response.status === 204) return undefined;
  if (path === "logout" && response.ok) throw new AuthError("INVALID_RESPONSE");
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthError(
      typeof data?.error?.code === "string"
        ? data.error.code
        : "REQUEST_FAILED",
      response.status,
    );
  return data;
}

function parseSession(value: unknown): Session {
  if (!value || typeof value !== "object")
    throw new AuthError("INVALID_RESPONSE");
  const { user, expiresAt } = value as Partial<Session>;
  if (
    !user ||
    typeof user.displayName !== "string" ||
    typeof user.email !== "string" ||
    user.membership !== Membership.Member ||
    typeof user.id !== "string" ||
    typeof expiresAt !== "string" ||
    !Number.isFinite(Date.parse(expiresAt))
  )
    throw new AuthError("INVALID_RESPONSE");
  return {
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      membership: user.membership,
    },
    expiresAt,
  };
}

export function googleAuthorizationUrl(value: unknown): string {
  if (typeof value !== "string") throw new AuthError("INVALID_RESPONSE");
  const url = new URL(value);
  if (
    url.origin !== "https://accounts.google.com" ||
    url.pathname !== "/o/oauth2/v2/auth" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new AuthError("INVALID_RESPONSE");
  }
  return url.href;
}

async function bridgeRequest(
  path: "attempt" | "complete",
  body: object,
  empty = false,
) {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "MeetingManager",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("NETWORK_ERROR");
  }
  if (empty && response.status === 204) return;
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new AuthError(
      typeof data?.error?.code === "string"
        ? data.error.code
        : "REQUEST_FAILED",
      response.status,
    );
  if (
    empty ||
    data?.ok !== true ||
    (path === "complete" &&
      (typeof data.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(data.expiresAt))))
  )
    throw new AuthError("INVALID_RESPONSE");
}
function assertActive(active: () => boolean) {
  if (!active()) throw new AuthError("AUTH_ATTEMPT_CANCELLED", 409);
}

export const authApi = {
  session: async () => parseSession(await request("session")),
  login: async (
    email: string,
    password: string,
    active = () => true,
  ): Promise<unknown> => {
    assertActive(active);
    await bridgeRequest("attempt", { action: "start" });
    assertActive(active);
    const result = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl: "/login?complete=1",
    });
    assertActive(active);
    if (!result?.ok || result.error)
      throw new AuthError(result?.error ?? "AUTH_UNAVAILABLE", result?.status);
    await bridgeRequest("complete", {});
    return undefined;
  },
  complete: () => bridgeRequest("complete", {}),
  googleStart: async (active = () => true) => {
    assertActive(active);
    await bridgeRequest("attempt", { action: "start" });
    assertActive(active);
    const csrfToken = await getCsrfToken();
    assertActive(active);
    if (!csrfToken) throw new AuthError("CSRF_REJECTED", 403);
    let response: Response;
    try {
      response = await fetch("/api/auth/signin/google", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          csrfToken,
          callbackUrl: "/login?complete=1",
          json: "true",
        }),
      });
    } catch {
      throw new AuthError("NETWORK_ERROR");
    }
    const activeAfterPost = active();
    const data = await response.json().catch(() => null);
    if (!activeAfterPost) throw new AuthError("AUTH_ATTEMPT_CANCELLED", 409);
    assertActive(active);
    if (!response.ok)
      throw new AuthError(
        typeof data?.error?.code === "string"
          ? data.error.code
          : "GOOGLE_AUTH_UNAVAILABLE",
        response.status,
      );
    return googleAuthorizationUrl(data?.url);
  },
  logout: async () => {
    const failures: unknown[] = [];
    await bridgeRequest("attempt", { action: "cancel" }, true).catch(
      (error: unknown) => {
        failures.push(error);
      },
    );
    try {
      const result = await signOut({ redirect: false, callbackUrl: "/login" });
      const url = new URL(result?.url ?? "", window.location.origin);
      if (
        !result?.url ||
        url.origin !== window.location.origin ||
        url.pathname !== "/login" ||
        url.search ||
        url.hash
      )
        throw new AuthError("LOGOUT_FAILED");
    } catch (error) {
      failures.push(error);
    }
    // Clear the backend access cookie as well as the NextAuth session cookie.
    await request("logout", {}).catch((error: unknown) => {
      failures.push(error);
    });
    if (failures.length) throw failures[0];
  },
};
export type AuthApi = typeof authApi;
