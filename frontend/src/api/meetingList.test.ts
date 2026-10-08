import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingListApi } from "./meetingList";
const date = "2026-10-08";
const meeting = {
  id: "meeting",
  title: "Interview",
  candidate: { name: "Candidate" },
  position: "Engineer",
  description: null,
  preparationNotes: "Portfolio",
  startsAt: "2026-10-08T03:00:00.000123Z",
  endsAt: "2026-10-08T04:00:00.000124Z",
  status: "PENDING",
  format: "ONSITE",
  location: null,
  organizer: { id: "owner", displayName: "Owner" },
  attendees: [],
  attendeeCount: 0,
};
const response = () => ({
  date,
  timeZone: "Asia/Bangkok",
  referenceTime: "2026-10-08T02:00:00.000001Z",
  snapshot: "opaque/+?",
  groups: {
    upcomingCurrent: { total: 17, page: 1, pageSize: 10, items: [meeting] },
    rejectedCancelled: {
      count: 12,
      items: [
        { ...meeting, id: "rejected", status: "REJECTED" },
        { ...meeting, id: "cancelled", status: "CANCELLED" },
      ],
    },
    past: {
      count: 11,
      items: [{ ...meeting, id: "past", status: "CONFIRMED" }],
    },
  },
});
const mock = (value: unknown, status = 200) => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(value), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());
describe("R1 selected-day list transport", () => {
  it("uses selected day with fixed page size and without identity and preserves counts, statuses, precision and both fields", async () => {
    const value = response(),
      fetch = mock(value);
    expect(await meetingListApi.read(date)).toEqual(value);
    expect(fetch.mock.calls[0][0]).toBe(
      `http://localhost:3001/api/v1/meetings?date=${date}&page=1&pageSize=10`,
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      redirect: "error",
    });
  });
  it("only requests upcomingCurrent continuation with numeric page and separate snapshot", async () => {
    const value = {
        date,
        timeZone: "Asia/Bangkok",
        referenceTime: response().referenceTime,
        snapshot: "opaque/+?",
        section: "upcomingCurrent",
        group: { total: 17, page: 2, pageSize: 10, items: [meeting] },
      },
      fetch = mock(value);
    expect(await meetingListApi.more(date, 2, "opaque/+?")).toEqual(value);
    const url = new URL(fetch.mock.calls[0][0]);
    expect([...url.searchParams.keys()]).toEqual([
      "date",
      "page",
      "pageSize",
      "section",
      "snapshot",
    ]);
    expect(url.searchParams.get("snapshot")).toBe("opaque/+?");
    expect(url.searchParams.get("section")).toBe("upcomingCurrent");
  });
  it.each([401, 403, 409, 503])(
    "preserves HTTP %s errors instead of empty",
    async (status) => {
      mock({ error: { code: "SAFE_ERROR" } }, status);
      await expect(meetingListApi.read(date)).rejects.toMatchObject({
        code: "SAFE_ERROR",
        status,
      });
    },
  );
  it.each(["date", "timeZone", "referenceTime", "snapshot", "groups"])(
    "rejects missing %s",
    async (field) => {
      mock({ ...response(), [field]: undefined });
      await expect(meetingListApi.read(date)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );
  it("rejects a response for another day", async () => {
    mock({ ...response(), date: "2026-10-09" });
    await expect(meetingListApi.read(date)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects combined section beyond five TOTAL", async () => {
    const value = response();
    value.groups.rejectedCancelled.items = Array.from(
      { length: 6 },
      (_, i) => ({
        ...meeting,
        id: `c${i}`,
        status: i % 2 ? "CANCELLED" : "REJECTED",
      }),
    );
    mock(value);
    await expect(meetingListApi.read(date)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects duplicate meeting IDs across sections", async () => {
    const value = response();
    value.groups.past.items[0].id = meeting.id;
    mock(value);
    await expect(meetingListApi.read(date)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects missing preparation field and strips candidate email via shared core projection", async () => {
    const value = response();
    mock({
      ...value,
      groups: {
        ...value.groups,
        upcomingCurrent: {
          ...value.groups.upcomingCurrent,
          items: [{ ...meeting, preparationNotes: undefined }],
        },
      },
    });
    await expect(meetingListApi.read(date)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    mock({
      ...value,
      groups: {
        ...value.groups,
        upcomingCurrent: {
          ...value.groups.upcomingCurrent,
          items: [
            {
              ...meeting,
              candidate: { name: "Candidate", email: "excluded@example.test" },
            },
          ],
        },
      },
    });
    expect(
      (await meetingListApi.read(date)).groups.upcomingCurrent.items[0]
        .candidate,
    ).toEqual({ name: "Candidate" });
  });
});
