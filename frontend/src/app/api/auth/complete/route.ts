import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { securityConfig } from "@/config/security.server";
import { createAuthOptions, wrapperClaims } from "../[...nextauth]/authOptions";
import { attempts, BridgeError } from "../[...nextauth]/attempts";
import {
  ATTEMPT_COOKIE,
  bridgeBody,
  bridgeFailure,
  cookieOptions,
  noStore,
} from "../[...nextauth]/bridge";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const body = await bridgeBody(request);
    if (Object.keys(body).length)
      throw new BridgeError("VALIDATION_ERROR", 400);
    const config = securityConfig();
    const binding = request.cookies.get(ATTEMPT_COOKIE)?.value;
    const entry = attempts.bound(binding);
    const cookiesOnly = new NextRequest(request.url, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    const options = createAuthOptions(binding, {});
    const token = await getToken({
      req: cookiesOnly,
      cookieName: config.sessionCookie,
      secret: config.secret,
      secureCookie: config.secure,
      decode: options.jwt!.decode,
    });
    const claims = wrapperClaims(token);
    if (attempts.bound(binding, claims.attemptId) !== entry)
      throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
    // Revalidate current DB membership before issuing the browser access cookie.
    // Only the already verified backend JWT is forwarded, never incoming cookies.
    let membershipResponse: Response;
    try {
      membershipResponse = await fetch(
        `${config.internalUrl}/api/v1/auth/session`,
        {
          method: "GET",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Accept: "application/json",
            Cookie: `mm_access=${claims.accessToken}`,
          },
        },
      );
    } catch {
      throw new BridgeError("DEPENDENCY_UNAVAILABLE", 503);
    }
    const membership = await membershipResponse.json().catch(() => null);
    if (!membershipResponse.ok) {
      if (
        membershipResponse.status === 403 &&
        membership?.error?.code === "CANDIDATE_DENIED"
      )
        throw new BridgeError("CANDIDATE_DENIED", 403);
      if (membershipResponse.status === 401)
        throw new BridgeError("UNAUTHENTICATED", 401);
      throw new BridgeError("DEPENDENCY_UNAVAILABLE", 503);
    }
    if (
      membership?.user?.membership !== "member" ||
      typeof membership.user.id !== "string"
    )
      throw new BridgeError("UNAUTHENTICATED", 401);
    if (attempts.bound(binding, claims.attemptId) !== entry)
      throw new BridgeError("AUTH_ATTEMPT_INVALID", 403);
    const remaining = Math.floor(
      (Date.parse(claims.expiresAt) - Date.now()) / 1000,
    );
    if (remaining <= 0) throw new BridgeError("UNAUTHENTICATED");
    attempts.claim(entry, "verified", "completing");
    const response = NextResponse.json({
      ok: true,
      expiresAt: claims.expiresAt,
    });
    response.cookies.set(
      "mm_access",
      claims.accessToken,
      cookieOptions("/api", remaining),
    );
    attempts.claim(entry, "completing", "completed");
    return noStore(response);
  } catch (error) {
    return bridgeFailure(error);
  }
}
