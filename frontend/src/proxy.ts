import { NextResponse } from "next/server";

export function proxy() {
  // Path=/api credentials are absent on /dashboard. The page must ask Express L4;
  // presence or absence of a NextAuth wrapper cannot authorize or deny that session.
  return NextResponse.next();
}
export const config = { matcher: ["/dashboard/:path*"] };
