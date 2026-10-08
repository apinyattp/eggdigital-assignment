import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { browserAuthConfig } from "@/config/security.server";
import { BridgeError } from "./attempts";

export const ATTEMPT_COOKIE = "mm_auth_attempt";
export function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export function cookieOptions(path: string, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: browserAuthConfig().secure,
    path,
    maxAge,
  };
}
export function bridgeFailure(error: unknown) {
  const known =
    error instanceof BridgeError
      ? error
      : new BridgeError("AUTH_UNAVAILABLE", 503);
  const response = NextResponse.json(
    {
      error: { code: known.code, message: "Authentication request failed" },
      requestId: randomUUID(),
    },
    { status: known.status },
  );
  if (known.retryAfter)
    response.headers.set("Retry-After", String(known.retryAfter));
  return noStore(response);
}
// Shared only by N1/N3. Official NextAuth routes retain their own form/CSRF protocol.
export async function bridgeBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get("origin") !== browserAuthConfig().origin ||
    request.headers.get("x-requested-with") !== "MeetingManager"
  )
    throw new BridgeError("CSRF_REJECTED", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new BridgeError("UNSUPPORTED_MEDIA_TYPE", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new BridgeError("VALIDATION_ERROR", 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16 * 1024) {
        await reader.cancel();
        throw new BridgeError("VALIDATION_ERROR", 400);
      }
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw error instanceof BridgeError
      ? error
      : new BridgeError("VALIDATION_ERROR", 400);
  }
}
