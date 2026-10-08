import { afterEach, describe, expect, it, vi } from "vitest";
import {
  meetingsApi,
  type CreateOnsiteRequest,
  type CreateOnlineRequest,
} from "./meetings";

const request: CreateOnsiteRequest = {
  requestId: "20000000-0000-4000-8000-000000000001",
  title: " Interview ",
  candidateName: " Candidate ",
  candidateEmail: "Candidate+tag@example.test",
  position: "Engineer",
  startsAt: "2026-10-09T09:00:00.000001+07:00",
  endsAt: "2026-10-09T10:00:00.000001+07:00",
  attendeeMemberIds: ["10000000-0000-4000-8000-000000000002"],
  description: "  เตรียม portfolio\nบรรทัดที่สอง  ",
  location: null,
};
const meeting = {
  id: "30000000-0000-4000-8000-000000000001",
  creatorId: "10000000-0000-4000-8000-000000000001",
  title: "Interview",
  description: request.description,
  preparationNotes: null,
  candidate: { name: "Candidate", email: "candidate+tag@example.test" },
  position: "Engineer",
  startsAt: "2026-10-09T02:00:00.000001Z",
  endsAt: "2026-10-09T03:00:00.000001Z",
  status: "PENDING",
  format: "ONSITE",
  location: null,
  meetingProvider: null,
  externalMeetingId: null,
  attendees: [
    {
      memberId: request.attendeeMemberIds[0],
      displayName: "Member",
      email: "member@example.test",
    },
  ],
  createdAt: "2026-10-08T00:00:00.000001Z",
  updatedAt: "2026-10-08T00:00:00.000001Z",
};
afterEach(() => vi.unstubAllGlobals());

describe("SA Online M2/M3 DTO — mocked transport", () => {
  it.each(["GOOGLE_MEET", "ZOOM"] as const)(
    "preserves historical %s meetings when reading",
    async (meetingProvider) => {
      const saved = {
        ...meeting,
        format: "ONLINE",
        meetingProvider,
        externalMeetingId: "room-123",
        preparationNotes: "Local preparation",
      };
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ meeting: saved })));
      vi.stubGlobal("fetch", fetcher);
      expect(await meetingsApi.read(meeting.id)).toEqual(saved);
      expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET" });
      expect(saved).not.toHaveProperty("joinUrl");
    },
  );
  it.each([
    { meetingProvider: null, externalMeetingId: "room" },
    { meetingProvider: "ZOOM", externalMeetingId: null },
    { meetingProvider: "OTHER", externalMeetingId: "room" },
    { meetingProvider: "GOOGLE_MEET", externalMeetingId: "" },
  ])("rejects inconsistent Online success %s", async (fields) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            meeting: { ...meeting, format: "ONLINE", ...fields },
          }),
        ),
      ),
    );
    await expect(meetingsApi.read(meeting.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});

describe("M2/M3 transport — TEST-MM-019/021/027/030/038, mocked HTTP only", () => {
  it.each([201, 200])(
    "handles create/replay HTTP %s without changing the request or stored timestamps/text",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ meeting }), { status }),
        );
      vi.stubGlobal("fetch", fetch);
      const result = await meetingsApi.create(request);
      expect(result).toEqual({ meeting, created: status === 201 });
      expect(fetch).toHaveBeenCalledOnce();
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe("http://localhost:3001/api/v1/meetings");
      expect(options).toEqual({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "MeetingManager",
        },
        body: JSON.stringify(request),
      });
      expect(JSON.parse(options.body)).not.toHaveProperty("preparationNotes");
      expect(JSON.parse(options.body)).not.toHaveProperty("creatorId");
    },
  );
  it("round-trips independent Description and Preparation Notes without copying or trimming", async () => {
    const body = {
      ...request,
      description: "  General detail  ",
      preparationNotes: "  Bring portfolio\nHeadphones  ",
    };
    const stored = {
      ...meeting,
      description: body.description,
      preparationNotes: body.preparationNotes,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ meeting: stored }), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await meetingsApi.create(body)).meeting).toEqual(stored);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it.each([undefined, 12, {}])(
    "rejects missing or malformed required preparationNotes: %s",
    async (preparationNotes) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ meeting: { ...meeting, preparationNotes } }),
              { status: 201 },
            ),
          ),
      );
      await expect(meetingsApi.create(request)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        status: 201,
      });
    },
  );
  it("omits optional defaults and does not map either UI text control", async () => {
    const {
      description: _description,
      location: _location,
      ...minimal
    } = request;
    void _description;
    void _location;
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ meeting })));
    vi.stubGlobal("fetch", fetch);
    await meetingsApi.create(minimal);
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent).toEqual(minimal);
    expect(sent).not.toHaveProperty("description");
    expect(sent).not.toHaveProperty("format");
    expect(sent).not.toHaveProperty("status");
  });
  it("reads the stored representation with GET and URL-encodes the resource segment", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          meeting: {
            ...meeting,
            secret: "discard",
            candidate: { ...meeting.candidate, extra: "discard" },
            attendees: [{ ...meeting.attendees[0], extra: "discard" }],
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    expect(await meetingsApi.read("../unsafe?value=1")).toEqual(meeting);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3001/api/v1/meetings/..%2Funsafe%3Fvalue%3D1",
    );
    expect(options).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    expect(options).not.toHaveProperty("body");
  });
  it("preserves safe validation fields without passing arbitrary server objects/messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "unused details",
              fields: {
                endsAt: "เวลาเลิกต้องหลังเวลาเริ่ม",
                unknown: { internal: "unused" },
              },
            },
          }),
          { status: 400 },
        ),
      ),
    );
    await expect(meetingsApi.create(request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "VALIDATION_ERROR",
      status: 400,
      fields: { endsAt: "เวลาเลิกต้องหลังเวลาเริ่ม" },
    });
  });
  it.each([401, 403, 404, 415, 500, 503])(
    "exposes HTTP %s without automatic retry or invented commit classification",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "SAFE_ERROR" } }), {
          status,
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(meetingsApi.create(request)).rejects.toMatchObject({
        status,
        code: "SAFE_ERROR",
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it("distinguishes transport loss without sending an automatic second POST", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("private transport detail"));
    vi.stubGlobal("fetch", fetch);
    await expect(meetingsApi.create(request)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      status: undefined,
      message: "NETWORK_ERROR",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    { ...meeting, attendees: [{ memberId: "x" }] },
    { ...meeting, format: "UNKNOWN" },
    { ...meeting, meetingProvider: "ZOOM" },
    { ...meeting, description: 7 },
  ])(
    "rejects an invalid representation without substituting the draft",
    async (value) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ meeting: value }), { status: 201 }),
          ),
      );
      await expect(meetingsApi.create(request)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        status: 201,
      });
    },
  );
  it("keeps HTTP success status when its body is unreadable; does not claim rollback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid JSON", { status: 201 })),
    );
    await expect(meetingsApi.create(request)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 201,
    });
  });
  it("rejects unexpected successful response statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(meetingsApi.read(meeting.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 204,
    });
  });
});

describe("BE e295e71 implemented creator mutation transport", () => {
  it("edits fields/team atomically without schedule fields or losing timestamp precision", async () => {
    const updated = {
      ...meeting,
      status: "CANCELLED",
      attendees: [{ ...meeting.attendees[0], memberId: null }],
    };
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ meeting: updated })));
    vi.stubGlobal("fetch", fetch);
    const body = {
      expectedUpdatedAt: meeting.updatedAt,
      description: "New description",
      preparationNotes: null,
      attendeeChanges: {
        addMemberIds: ["new-member"],
        removeEmails: ["member@example.test"],
      },
    };
    expect(await meetingsApi.edit(meeting.id, body)).toEqual(updated);
    expect(fetch.mock.calls[0][0]).toBe(
      `http://localhost:3001/api/v1/meetings/${meeting.id}/edit`,
    );
    const options = fetch.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual(body);
    expect(options).toMatchObject({
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "MeetingManager" },
    });
    expect(JSON.parse(options.body)).not.toHaveProperty("startsAt");
    expect(JSON.parse(options.body)).not.toHaveProperty("endsAt");
  });
  it("sends exact version for team and cancel without notifications/provider parameters", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ meeting }))),
      );
    vi.stubGlobal("fetch", fetch);
    const body = {
      expectedUpdatedAt: meeting.updatedAt,
      addMemberIds: [],
      removeEmails: [],
    };
    await meetingsApi.team(meeting.id, body);
    await meetingsApi.cancel(meeting.id, meeting.updatedAt);
    expect(fetch.mock.calls[0][0]).toContain("/team");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
    expect(fetch.mock.calls[1][0]).toContain("/cancel");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      expectedUpdatedAt: meeting.updatedAt,
    });
  });
  it("exposes stale 409 without silently updating version or retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "STALE_MEETING" } }), {
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      meetingsApi.edit(meeting.id, {
        expectedUpdatedAt: meeting.updatedAt,
        title: "Edited",
      }),
    ).rejects.toMatchObject({ code: "STALE_MEETING", status: 409 });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("E4 delete and abortable creator read — BE1fbe contract", () => {
  it("deletes with exact version and accepts 204 without reading a JSON representation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      meetingsApi.delete("id/path", meeting.updatedAt),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:3001/api/v1/meetings/id%2Fpath/delete",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: {
        "X-Requested-With": "MeetingManager",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expectedUpdatedAt: meeting.updatedAt }),
    });
  });
  it.each([401, 403, 404, 409, 503])(
    "preserves delete HTTP %s without automatic retry or false completion",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "SAFE_ERROR" } }), {
          status,
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        meetingsApi.delete(meeting.id, meeting.updatedAt),
      ).rejects.toMatchObject({ code: "SAFE_ERROR", status });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it("does not accept a 200 representation as delete success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ meeting }))),
    );
    await expect(
      meetingsApi.delete(meeting.id, meeting.updatedAt),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
  it("exposes unknown network outcome for explicit reconciliation", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      meetingsApi.delete(meeting.id, meeting.updatedAt),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("passes read cancellation without changing creator-read projection", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ meeting })));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await meetingsApi.read(meeting.id, controller.signal)).toEqual(
      meeting,
    );
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});

it("reads manual Online meetings with null provider and external ID", async () => {
  const manual = {
    ...meeting,
    format: "ONLINE",
    joinUrl: "https://meeting.example.test/room",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ meeting: manual }))),
  );
  await expect(meetingsApi.read(meeting.id)).resolves.toMatchObject({
    format: "ONLINE",
    meetingProvider: null,
    externalMeetingId: null,
    joinUrl: manual.joinUrl,
  });
});

it("creates and replays a manual Online request with its exact HTTPS link and no provider fields", async () => {
  const body: CreateOnlineRequest = { ...request, format: "ONLINE", joinUrl: "https://meeting.example.test/room" };
  const saved = { ...meeting, format: "ONLINE", joinUrl: body.joinUrl };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ meeting: saved }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ meeting: saved }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await meetingsApi.create(body)).toEqual({ meeting: saved, created: true });
  expect(await meetingsApi.create(body)).toEqual({ meeting: saved, created: false });
  for (const [, options] of fetcher.mock.calls) {
    expect(JSON.parse(options.body)).toEqual(body);
    expect(JSON.parse(options.body)).not.toHaveProperty("meetingProvider");
  }
});
