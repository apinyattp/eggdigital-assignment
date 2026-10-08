export class AuthError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}

export class BridgeError extends AuthError {
  constructor(
    code: string,
    status = 401,
    public retryAfter?: number,
  ) {
    super(code, status);
  }
}
