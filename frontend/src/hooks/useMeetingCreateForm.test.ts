import { describe, expect, it } from "vitest";
import {
  bangkokToday,
  newMeetingCreateForm,
  validateOnsiteForm,
  validateOnlineForm,
} from "./useMeetingCreateForm";
const now = new Date("2026-10-08T10:00:00+07:00");
const valid = () => ({
  ...newMeetingCreateForm(),
  candidateName: "Name",
  candidateEmail: "name@example.test",
  title: "Interview",
  position: "Engineer",
  startDate: "2026-10-08",
  endDate: "2026-10-08",
  start: "09:00",
  end: "11:00",
});
describe("confirmed Add temporal and independent-text rules", () => {
  it(
    "keeps Add rules and independent local preparation for manual Online meetings",
    () => {
      const values = {
        ...valid(),
        description: "  Description  ",
        joinUrl: " https://meeting.example.test/room ",
        preparationNotes: "  Private preparation  ",
      };
      const result = validateOnlineForm(values, ["member"], now);
      expect(result.fields).toEqual({});
      expect(result.payload).toEqual({
        ...validateOnsiteForm(values, ["member"], now).payload,
        format: "ONLINE",
        joinUrl: "https://meeting.example.test/room",
      });
      expect(
        validateOnlineForm(
          { ...values, end: "09:30" },
          ["member"],
          now,
        ).fields.end,
      ).toBeTruthy();
      expect(result.payload).not.toHaveProperty("creatorId");
    },
  );
  it("uses Bangkok calendar day across the UTC boundary", () => {
    expect(bangkokToday(new Date("2026-10-07T17:00:00Z"))).toBe("2026-10-08");
    expect(bangkokToday(new Date("2026-10-07T16:59:59Z"))).toBe("2026-10-07");
  });
  it("allows earlier start today with end in future", () => {
    expect(validateOnsiteForm(valid(), ["member"], now).fields).toEqual({});
  });
  it("allows future-date morning and cross-day range without rollover assumptions", () => {
    expect(
      validateOnsiteForm(
        {
          ...valid(),
          startDate: "2026-10-09",
          endDate: "2026-10-09",
          start: "07:00",
          end: "08:00",
        },
        ["member"],
        now,
      ).fields,
    ).toEqual({});
    const result = validateOnsiteForm(
      { ...valid(), endDate: "2026-10-09", start: "23:00", end: "01:00" },
      ["member"],
      now,
    );
    expect(result.fields).toEqual({});
    expect(result.payload.startsAt).toBe("2026-10-08T23:00:00+07:00");
    expect(result.payload.endsAt).toBe("2026-10-09T01:00:00+07:00");
  });
  it.each(["09:30", "10:00"])("rejects full end at/before now: %s", (end) => {
    expect(
      validateOnsiteForm({ ...valid(), end }, ["member"], now).fields.end,
    ).toBeTruthy();
  });
  it("rejects earlier start date and full end before/equal start", () => {
    expect(
      validateOnsiteForm(
        { ...valid(), startDate: "2026-10-07" },
        ["member"],
        now,
      ).fields.startDate,
    ).toBeTruthy();
    expect(
      validateOnsiteForm(
        { ...valid(), start: "12:00", end: "11:00" },
        ["member"],
        now,
      ).fields.end,
    ).toBeTruthy();
    expect(
      validateOnsiteForm(
        { ...valid(), start: "12:00", end: "12:00" },
        ["member"],
        now,
      ).fields.end,
    ).toBeTruthy();
  });
  it("keeps optional description/preparation independently including whitespace", () => {
    const result = validateOnsiteForm(
      {
        ...valid(),
        description: "  General\n detail  ",
        preparationNotes: "  Bring portfolio  ",
      },
      ["member"],
      now,
    );
    expect(result.payload.description).toBe("  General\n detail  ");
    expect(result.payload.preparationNotes).toBe("  Bring portfolio  ");
    expect(
      validateOnsiteForm(
        { ...valid(), description: "", preparationNotes: "" },
        ["member"],
        now,
      ).fields,
    ).toEqual({});
  });
  it("requires candidate/title/position/email and at least one team Member", () => {
    expect(
      validateOnsiteForm(
        {
          ...valid(),
          candidateEmail: "bad",
          candidateName: "",
          title: "",
          position: "",
        },
        [],
        now,
      ).fields,
    ).toMatchObject({
      candidateName: expect.any(String),
      candidateEmail: expect.any(String),
      title: expect.any(String),
      position: expect.any(String),
      attendeeMemberIds: expect.any(String),
    });
  });
});

it.each([
  "",
  "http://example.test/room",
  "javascript:alert(1)",
  "/room",
  "https://user@example.test/room",
])("rejects invalid manual Add link %s", (joinUrl) => {
  expect(
    validateOnlineForm({ ...valid(), joinUrl }, ["member"], now)
      .fields.joinUrl,
  ).toBeTruthy();
});
