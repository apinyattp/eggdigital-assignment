import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingSummaryApi } from "./meetingSummary";
const meeting = {
  id: "meeting",
  title: "Interview",
  candidate: { name: "Candidate" },
  position: "Engineer",
  description: "General",
  preparationNotes: "Preparation",
  startsAt: "2026-10-08T03:00:00.000123Z",
  endsAt: "2026-10-08T04:00:00.000124Z",
  status: "CANCELLED",
  format: "ONSITE",
  location: null,
  organizer: { id: "owner", displayName: "Owner" },
  attendees: [
    { memberId: null, displayName: "Guest", email: "guest@example.test" },
  ],
  attendeeCount: 1,
};
afterEach(() => vi.unstubAllGlobals());
describe("R4 Summary transport — implemented BE core projection", () => {
  it("reads Summary rather than creator-only M3, omits candidate email and preserves raw times", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meeting: {
            ...meeting,
            candidate: {
              ...meeting.candidate,
              email: "not-in-core@example.test",
            },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await meetingSummaryApi.read("id/path")).toEqual(meeting);
    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:3001/api/v1/meetings/id%2Fpath/summary",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  });
  it.each(["preparationNotes", "attendeeCount", "organizer"])(
    "rejects missing required field %s",
    async (field) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ meeting: { ...meeting, [field]: undefined } }),
            ),
          ),
      );
      await expect(meetingSummaryApi.read("meeting")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        status: 200,
      });
    },
  );
  it.each([401, 403, 404, 503])(
    "does not convert HTTP %s into empty or cached Summary",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "SAFE_ERROR" } }), {
            status,
          }),
        ),
      );
      await expect(meetingSummaryApi.read("meeting")).rejects.toMatchObject({
        code: "SAFE_ERROR",
        status,
      });
    },
  );
});
