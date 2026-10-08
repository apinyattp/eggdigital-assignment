import { NextRequest, NextResponse } from "next/server";
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
    if (
      Object.keys(body).length !== 1 ||
      (body.action !== "start" && body.action !== "cancel")
    )
      throw new BridgeError("VALIDATION_ERROR", 400);
    const binding = request.cookies.get(ATTEMPT_COOKIE)?.value;
    if (body.action === "cancel") {
      attempts.cancel(binding);
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set("mm_access", "", cookieOptions("/api", 0));
      response.cookies.set(ATTEMPT_COOKIE, "", cookieOptions("/api/auth", 0));
      return noStore(response);
    }
    const started = attempts.start(binding);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      ATTEMPT_COOKIE,
      started.binding,
      cookieOptions("/api/auth", 300),
    );
    return noStore(response);
  } catch (error) {
    return bridgeFailure(error);
  }
}
