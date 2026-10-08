import "server-only";
import type { AuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { decode, encode, type JWT } from "next-auth/jwt";
import { issueIdentity, type IssuedIdentity } from "@/api/serverAuth";
import { securityConfig } from "@/config/security.server";
import { attempts, BridgeError, type Attempt } from "./attempts";

export type RequestAuthContext = {
  attempt?: Attempt;
  expiresAt?: string;
  method?: "password" | "google";
};
export function wrapperClaims(token: JWT | null) {
  if (
    !token ||
    typeof token.backendAccessToken !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      token.backendAccessToken,
    ) ||
    typeof token.backendExpiresAt !== "string" ||
    !Number.isFinite(Date.parse(token.backendExpiresAt)) ||
    Date.parse(token.backendExpiresAt) <= Date.now() ||
    typeof token.attemptId !== "string" ||
    !["password", "google"].includes(String(token.authMethod))
  )
    throw new BridgeError("UNAUTHENTICATED");
  return {
    accessToken: token.backendAccessToken,
    expiresAt: token.backendExpiresAt,
    attemptId: token.attemptId,
  };
}

export function createAuthOptions(
  binding: string | undefined,
  context: RequestAuthContext,
): AuthOptions {
  const config = securityConfig();
  let issued: IssuedIdentity | undefined;
  return {
    secret: config.secret,
    session: { strategy: "jwt", maxAge: config.ttl },
    useSecureCookies: config.secure,
    cookies: {
      sessionToken: {
        name: config.sessionCookie,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: config.secure,
        },
      },
    },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      CredentialsProvider({
        credentials: {
          email: { type: "email" },
          password: { type: "password" },
        },
        async authorize(credentials) {
          try {
            if (
              !credentials ||
              typeof credentials.email !== "string" ||
              typeof credentials.password !== "string"
            )
              throw new BridgeError("VALIDATION_ERROR", 400);
            const entry = attempts.bound(binding);
            attempts.claim(entry, "pending", "exchanging");
            context.attempt = entry;
            context.method = "password";
            issued = await issueIdentity({
              method: "password",
              email: credentials.email,
              password: credentials.password,
            });
            attempts.assert(entry, ["exchanging"]);
            return {
              id: issued.user.id!,
              name: issued.user.displayName,
              email: issued.user.email,
            };
          } catch (error) {
            if (context.attempt) attempts.fail(context.attempt);
            throw new Error(
              error instanceof BridgeError ? error.code : "AUTH_UNAVAILABLE",
            );
          }
        },
      }),
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? [
            GoogleProvider({
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              checks: ["state", "pkce", "nonce"],
            }),
          ]
        : []),
    ],
    callbacks: {
      async signIn({ account }) {
        if (account?.provider !== "google") return true;
        try {
          if (
            !context.attempt ||
            context.method !== "google" ||
            typeof account.id_token !== "string"
          )
            throw new BridgeError("GOOGLE_IDENTITY_INVALID", 401);
          attempts.assert(context.attempt, ["exchanging"]);
          issued = await issueIdentity({
            method: "google",
            idToken: account.id_token,
          });
          attempts.assert(context.attempt, ["exchanging"]);
          return true;
        } catch (error) {
          if (context.attempt) attempts.fail(context.attempt);
          return `${config.origin}/login?authError=${encodeURIComponent(error instanceof BridgeError ? error.code : "AUTH_UNAVAILABLE")}`;
        }
      },
      async jwt({ token, trigger }) {
        if (trigger === "update") {
          context.expiresAt = wrapperClaims(token).expiresAt;
          return token;
        }
        if (issued && context.attempt) {
          attempts.assert(context.attempt, ["exchanging"]);
          const result = {
            backendAccessToken: issued.accessToken,
            backendExpiresAt: issued.expiresAt,
            attemptId: context.attempt.id,
            authMethod: context.method,
          };
          wrapperClaims(result);
          attempts.claim(context.attempt, "exchanging", "verified");
          context.expiresAt = issued.expiresAt;
          return result;
        }
        context.expiresAt = wrapperClaims(token).expiresAt;
        return token;
      },
      async session({ token }) {
        return { expires: wrapperClaims(token).expiresAt };
      },
      async redirect({ url }) {
        try {
          const target = new URL(url, config.origin);
          return target.origin === config.origin && target.pathname === "/login"
            ? target.href
            : `${config.origin}/login`;
        } catch {
          return `${config.origin}/login`;
        }
      },
    },
    jwt: {
      async encode(params) {
        const claims = wrapperClaims(params.token ?? null);
        const remaining = Math.floor(
          (Date.parse(claims.expiresAt) - Date.now()) / 1000,
        );
        if (remaining <= 0) throw new BridgeError("UNAUTHENTICATED");
        if (context.attempt) attempts.assert(context.attempt, ["verified"]);
        const result = await encode({ ...params, maxAge: remaining });
        if (context.attempt) attempts.assert(context.attempt, ["verified"]);
        return result;
      },
      async decode(params) {
        const result = await decode(params);
        wrapperClaims(result);
        return result;
      },
    },
    // Never pass credential/provider exceptions or token-bearing metadata to logs.
    logger: { error() {}, warn() {}, debug() {} },
    debug: false,
  };
}
