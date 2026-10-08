import { afterEach, describe, expect, it, vi } from "vitest";
import { interviewContentApi as api } from "./interviewContent";
const version = "2026-10-08T04:05:00.000123Z";
const item = {
  id: "own",
  text: "Stored feedback",
  author: { displayName: "Member" },
  isOwn: true,
  createdAt: "2026-10-08T04:00:00.000001Z",
  updatedAt: version,
};
afterEach(() => vi.unstubAllGlobals());
function respond(value: unknown, status = 200) {
  const fetch = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(value), { status })),
    );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("N1/N2/F1/F2/F3 transport — SA bcb893dd; mocked HTTP", () => {
  it.each([undefined, -1, 0, 1.5, "2"])(
    "rejects inconsistent feedback totalPages %j",
    async (totalPages) => {
      respond({
        items: [],
        ownFeedbackId: null,
        page: 1,
        pageSize: 50,
        total: 51,
        totalPages,
        asOf: version,
        snapshot: "snapshot",
      });
      await expect(api.readFeedback("meeting")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );
  it("reads only notes/me, distinguishing absent from stored empty text", async () => {
    let fetch = respond({ note: null });
    expect(await api.readNote("meeting")).toBeNull();
    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:3001/api/v1/meetings/meeting/notes/me",
    );
    fetch = respond({ note: { text: "", updatedAt: version } });
    expect(await api.readNote("meeting")).toEqual({
      text: "",
      updatedAt: version,
    });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  });
  it("saves verbatim private note text/version without author fields or Feedback refresh", async () => {
    const body = { text: "  Private\n note  ", expectedUpdatedAt: version };
    const fetch = respond({ note: { text: body.text, updatedAt: version } });
    expect(await api.saveNote("../meeting?x=1", body)).toEqual({
      text: body.text,
      updatedAt: version,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toContain(
      "/meetings/..%2Fmeeting%3Fx%3D1/notes/me",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "X-Requested-With": "MeetingManager" },
      body: JSON.stringify(body),
    });
  });
  it("retains ownFeedbackId outside the current batch and encodes separate snapshot and numeric page", async () => {
    const fetch = respond({
      items: [
        {
          ...item,
          isOwn: false,
          author: { displayName: "Other", email: "omit", author_key: "omit" },
        },
      ],
      ownFeedbackId: "outside-50",
      page: 2,
      pageSize: 50,
      total: 51,
      totalPages: 2,
      asOf: "2026-10-08T06:00:00Z",
      snapshot: "opaque+/=?",
    });
    expect(await api.readFeedback("meeting", 2, "opaque+/=?")).toEqual({
      items: [{ ...item, isOwn: false, author: { displayName: "Other" } }],
      ownFeedbackId: "outside-50",
      page: 2,
      pageSize: 50,
      total: 51,
      totalPages: 2,
      asOf: "2026-10-08T06:00:00Z",
      snapshot: "opaque+/=?",
    });
    expect(fetch.mock.calls[0][0]).toContain(
      "/feedback?page=2&pageSize=50&snapshot=opaque%2B%2F%3D%3F",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([200, 201])(
    "preserves create/replay status %s and key without requesting latest Feedback",
    async (status) => {
      const fetch = respond({ feedback: item }, status);
      const body = { requestId: "request", text: "  Draft text  " };
      expect(await api.createFeedback("meeting", body)).toEqual({
        feedback: item,
        created: status === 201,
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(body));
    },
  );
  it("edits by encoded ID with the exact stored microsecond version", async () => {
    const fetch = respond({ feedback: item });
    const body = { text: "Edited", expectedUpdatedAt: version };
    expect(await api.editFeedback("meeting", "id/part", body)).toEqual(item);
    expect(fetch.mock.calls[0][0]).toContain("/feedback/id%2Fpart/edit");
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(body));
  });
  it.each([400, 401, 403, 404, 409, 503])(
    "returns safe error %s without automatic retry or version replacement",
    async (status) => {
      const fetch = respond(
        {
          error: {
            code: status === 503 ? "DEPENDENCY_UNAVAILABLE" : "SAFE_ERROR",
            message: "private details",
          },
        },
        status,
      );
      await expect(
        api.saveNote("meeting", { text: "note", expectedUpdatedAt: null }),
      ).rejects.toMatchObject({
        status,
        code: status === 503 ? "DEPENDENCY_UNAVAILABLE" : "SAFE_ERROR",
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
  it("rejects incomplete list metadata rather than inferring permission to add", async () => {
    respond({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 });
    await expect(api.readFeedback("meeting")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
  });
  it("preserves successful HTTP status on malformed create acknowledgement", async () => {
    respond({ feedback: { ...item, isOwn: undefined } }, 201);
    await expect(
      api.createFeedback("meeting", { requestId: "request", text: "draft" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 201 });
  });
  it("does not treat network failure as known rollback", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new Error("private network detail"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      api.createFeedback("meeting", { requestId: "request", text: "draft" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", status: undefined });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
