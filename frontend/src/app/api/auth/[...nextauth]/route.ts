import NextAuth from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { createAuthOptions, type RequestAuthContext } from "./authOptions";
import { attempts, BridgeError } from "./attempts";
import { ATTEMPT_COOKIE, bridgeFailure, noStore } from "./bridge";
import { browserAuthConfig } from "@/config/security.server";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ nextauth: string[] }> };
function failure(request: NextRequest, error: unknown) {
  if (
    request.method === "GET" &&
    request.nextUrl.pathname.endsWith("/callback/google")
  ) {
    const code = error instanceof BridgeError ? error.code : "AUTH_UNAVAILABLE";
    return noStore(
      NextResponse.redirect(
        `${browserAuthConfig().origin}/login?authError=${encodeURIComponent(code)}`,
        303,
      ),
    );
  }
  return bridgeFailure(error);
}

async function handle(request: NextRequest, route: RouteContext) {
  const context: RequestAuthContext = {};
  try {
    const params = await route.params;
    const binding = request.cookies.get(ATTEMPT_COOKIE)?.value;
    const googleStart =
      params.nextauth[0] === "signin" && params.nextauth[1] === "google";
    const googleCallback =
      params.nextauth[0] === "callback" && params.nextauth[1] === "google";
    if (googleStart) {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)
        throw new BridgeError("GOOGLE_AUTH_UNAVAILABLE", 503);
      const entry = attempts.bound(binding);
      attempts.assert(entry, ["pending"]);
      if (entry.googleStateHash)
        throw new BridgeError("AUTH_ATTEMPT_USED", 409);
      context.attempt = entry;
    }
    if (googleCallback) {
      const states = request.nextUrl.searchParams.getAll("state");
      if (states.length !== 1)
        throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
      context.attempt = attempts.claimGoogle(states[0], binding);
      context.method = "google";
    }
    const options = createAuthOptions(binding, context);
    const response: Response = await NextAuth(request, route, options);
    if (googleStart && context.attempt) {
      const location =
        response.headers.get("Location") ??
        (
          await response
            .clone()
            .json()
            .catch(() => null)
        )?.url;
      if (typeof location !== "string")
        throw new BridgeError("GOOGLE_AUTH_UNAVAILABLE", 503);
      const destination = new URL(location);
      const states = destination.searchParams.getAll("state");
      if (
        destination.origin !== "https://accounts.google.com" ||
        destination.pathname !== "/o/oauth2/v2/auth" ||
        destination.username ||
        destination.password ||
        destination.hash ||
        states.length !== 1 ||
        !states[0]
      )
        throw new BridgeError("GOOGLE_AUTH_UNAVAILABLE", 503);
      attempts.bindGoogleState(context.attempt, states[0]);
    }
    if (googleCallback && context.attempt?.status === "exchanging")
      attempts.fail(context.attempt);
    if (context.attempt) {
      try {
        attempts.assert(
          context.attempt,
          googleStart ? ["pending"] : ["verified", "failed"],
        );
      } catch {
        return failure(request, new BridgeError("AUTH_ATTEMPT_CANCELLED", 409));
      }
    }
    if (
      googleCallback &&
      context.attempt?.status === "failed" &&
      request.nextUrl.searchParams.getAll("error").length === 1 &&
      request.nextUrl.searchParams.get("error") === "access_denied"
    )
      return failure(request, new BridgeError("PROVIDER_CANCELLED", 401));
    // Cap library rolling cookie expiry to the immutable backend deadline, including chunks.
    if (context.expiresAt) {
      const config = browserAuthConfig();
      const cookies = response.headers.getSetCookie();
      response.headers.delete("Set-Cookie");
      for (const cookie of cookies) {
        const name = cookie.slice(0, cookie.indexOf("="));
        const sessionCookie =
          name === config.sessionCookie ||
          name.startsWith(`${config.sessionCookie}.`);
        response.headers.append(
          "Set-Cookie",
          sessionCookie && !/Max-Age=0(?:;|$)/i.test(cookie)
            ? `${cookie.replace(/;\s*(Expires|Max-Age)=[^;]*/gi, "")}; Expires=${new Date(context.expiresAt).toUTCString()}`
            : cookie,
        );
      }
    }
    return noStore(response);
  } catch (error) {
    if (context.attempt) attempts.fail(context.attempt);
    return failure(request, error);
  }
}
export { handle as GET, handle as POST };
