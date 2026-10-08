import { AuthError } from "./authError";

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "Incorrect email or password.",
  VALIDATION_ERROR: "Enter a valid email and password.",
  MEMBER_NOT_FOUND: "Your account is not registered in this system.",
  CANDIDATE_DENIED: "Candidate accounts cannot access this system.",
  UNAUTHENTICATED: "Please sign in again.",
  TOO_MANY_REQUESTS: "Too many requests. Please wait and try again.",
  OAUTH_TRANSACTION_INVALID:
    "This Google sign-in attempt has expired or is invalid. Please start again.",
  GOOGLE_IDENTITY_INVALID: "Unable to verify your Google account. Please start again.",
  GOOGLE_AUTH_UNAVAILABLE: "Unable to connect to Google right now. Please try again.",
  AUTH_ATTEMPT_CANCELLED: "Sign-in cancelled.",
  AUTH_ATTEMPT_INVALID: "This sign-in attempt has expired or is invalid. Please start again.",
  AUTH_ATTEMPT_USED: "This sign-in attempt has already been used. Please start again.",
  EMAIL_OWNERSHIP_UNVERIFIED: "Unable to verify ownership of this email address.",
  PROVIDER_CANCELLED: "Google sign-in cancelled. Start again when you are ready.",
  CSRF_REJECTED: "Unable to continue. Reload the page and try again.",
};

export function authErrorMessage(error: unknown): string {
  return error instanceof AuthError && messages[error.code]
    ? messages[error.code]
    : "Unable to continue right now. Please try again.";
}
