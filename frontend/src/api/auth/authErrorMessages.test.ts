import { describe, expect, it } from "vitest";
import { AuthError, BridgeError } from "./authError";
import { authErrorMessage } from "./authErrorMessages";

// Characterize the current copy and lookup semantics before moving the module.
describe("Auth error messages", () => {
  it.each([
    ["INVALID_CREDENTIALS", "Incorrect email or password."],
    ["VALIDATION_ERROR", "Enter a valid email and password."],
    ["MEMBER_NOT_FOUND", "Your account is not registered in this system."],
    ["CANDIDATE_DENIED", "Candidate accounts cannot access this system."],
    ["UNAUTHENTICATED", "Please sign in again."],
    ["TOO_MANY_REQUESTS", "Too many requests. Please wait and try again."],
    [
      "OAUTH_TRANSACTION_INVALID",
      "This Google sign-in attempt has expired or is invalid. Please start again.",
    ],
    [
      "GOOGLE_IDENTITY_INVALID",
      "Unable to verify your Google account. Please start again.",
    ],
    [
      "GOOGLE_AUTH_UNAVAILABLE",
      "Unable to connect to Google right now. Please try again.",
    ],
    ["AUTH_ATTEMPT_CANCELLED", "Sign-in cancelled."],
    [
      "AUTH_ATTEMPT_INVALID",
      "This sign-in attempt has expired or is invalid. Please start again.",
    ],
    [
      "AUTH_ATTEMPT_USED",
      "This sign-in attempt has already been used. Please start again.",
    ],
    [
      "EMAIL_OWNERSHIP_UNVERIFIED",
      "Unable to verify ownership of this email address.",
    ],
    [
      "PROVIDER_CANCELLED",
      "Google sign-in cancelled. Start again when you are ready.",
    ],
    ["CSRF_REJECTED", "Unable to continue. Reload the page and try again."],
  ])("keeps the existing %s message", (code, message) => {
    expect(authErrorMessage(new AuthError(code, 400))).toBe(message);
  });

  it("recognizes BridgeError through the single AuthError class owner", () => {
    const error = new BridgeError("UNAUTHENTICATED");
    expect(error).toBeInstanceOf(AuthError);
    expect(authErrorMessage(error)).toBe("Please sign in again.");
  });

  it.each([
    null,
    undefined,
    "INVALID_CREDENTIALS",
    { code: "INVALID_CREDENTIALS" },
    new Error("raw backend details"),
    new AuthError("UNKNOWN_RAW_CODE"),
    new AuthError(""),
  ])("uses the fallback for unknown or non-AuthError input %#", (error) => {
    expect(authErrorMessage(error)).toBe(
      "Unable to continue right now. Please try again.",
    );
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "preserves existing inherited-key lookup for %s without adding hardening",
    (code) => {
      // This records legacy behavior; it is not a recommendation or a new rule.
      expect(authErrorMessage(new AuthError(code))).toBe(
        code === "__proto__"
          ? Object.prototype
          : Reflect.get(Object.prototype, code),
      );
    },
  );
});
