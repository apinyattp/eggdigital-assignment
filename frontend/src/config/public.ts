// Public browser endpoint only; server credentials must never be added here.
export const publicConfig = {
  apiBaseUrl:
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1",
} as const;
