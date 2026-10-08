export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
