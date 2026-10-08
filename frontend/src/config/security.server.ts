import "server-only";

export function browserAuthConfig() {
  const origin = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("AUTH_UNAVAILABLE");
  const secure = process.env.COOKIE_SECURE === "true";
  if (origin.protocol === "https:" && !secure)
    throw new Error("AUTH_UNAVAILABLE");
  return {
    origin: origin.origin,
    secure,
    sessionCookie: `${secure ? "__Secure-" : ""}next-auth.session-token`,
  };
}

export function securityConfig() {
  const secret = process.env.NEXTAUTH_SECRET;
  const serviceKey = process.env.AUTH_SERVICE_KEY;
  const internalUrl = new URL(
    process.env.AUTH_BACKEND_INTERNAL_URL ?? "http://localhost:3001",
  );
  const ttl = Number(process.env.JWT_ACCESS_TTL_SECONDS ?? "900");
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    !serviceKey ||
    Buffer.byteLength(serviceKey) < 32 ||
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    !["http:", "https:"].includes(internalUrl.protocol) ||
    internalUrl.username ||
    internalUrl.password ||
    internalUrl.search ||
    internalUrl.hash ||
    internalUrl.pathname !== "/"
  )
    throw new Error("AUTH_UNAVAILABLE");
  return {
    ...browserAuthConfig(),
    secret,
    serviceKey,
    internalUrl: internalUrl.origin,
    ttl,
  };
}
