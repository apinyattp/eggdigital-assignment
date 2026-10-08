export function meetingJoinUrl(
  value: unknown,
  format: "ONSITE" | "ONLINE",
  status: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (format !== "ONLINE" || status === "CANCELLED") {
    return null;
  }
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
