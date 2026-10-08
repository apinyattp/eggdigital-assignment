import { describe, expect, it } from "vitest";
import { meetingJoinUrl } from "./meetingLinks";

describe("server-provided participant link boundaries", () => {
  it.each([
    "javascript:alert(1)",
    "https://user@zoom.us/j/123",
    "http://meet.google.com/abc-defg-hij",
  ])("rejects unsafe link %s", (value) => {
    expect(meetingJoinUrl(value, "ONLINE", "PENDING")).toBeNull();
  });
  it("preserves a participant URL including passcode and never creates one from an ID", () => {
    expect(
      meetingJoinUrl(
        "https://example.zoom.us/j/123?pwd=opaque",
        "ONLINE",
        "PENDING",
      ),
    ).toBe("https://example.zoom.us/j/123?pwd=opaque");
    expect(meetingJoinUrl(undefined, "ONLINE", "PENDING")).toBeUndefined();
    expect(meetingJoinUrl("123", "ONLINE", "PENDING")).toBeNull();
  });
  it("hides cancelled and Onsite joins even when a response includes an old URL", () => {
    expect(
      meetingJoinUrl(
        "https://meet.google.com/abc-defg-hij",
        "ONLINE",
        "CANCELLED",
      ),
    ).toBeNull();
    expect(
      meetingJoinUrl("https://zoom.us/j/123", "ONSITE", "PENDING"),
    ).toBeNull();
  });
});
