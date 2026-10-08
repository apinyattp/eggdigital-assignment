export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
export const unavailable = () => new ApiError(503, 'DEPENDENCY_UNAVAILABLE');
