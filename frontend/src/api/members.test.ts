import { afterEach, describe, expect, it, vi } from "vitest";
import { membersApi } from "./members";

afterEach(() => vi.unstubAllGlobals());
describe("M1 member transport — TEST-MM-013/044", () => {
  it("does not request empty or whitespace queries", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await membersApi.search("  ")).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends encoded literal query, page and pageSize with cookie/no-store; projects safe member fields", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "member",
              displayName: "Member",
              email: "member@example.test",
              extra: "omitted",
            },
          ],
          page: 2,
          pageSize: 20,
          total: 25,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await membersApi.search("  %_\\ +&  ", 2);
    const [url, options] = fetch.mock.calls[0];
    expect(new URL(url).searchParams.get("query")).toBe("%_\\ +&");
    expect(new URL(url).searchParams.get("page")).toBe("2");
    expect(new URL(url).searchParams.get("pageSize")).toBe("20");
    expect(options).toMatchObject({
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    expect(result).toEqual({
      items: [
        { id: "member", displayName: "Member", email: "member@example.test" },
      ],
      page: 2,
      pageSize: 20,
      total: 25,
    });
  });
  it.each([401, 403, 503])(
    "preserves HTTP %s without turning failure into empty results",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ error: { code: "SAFE_ERROR" } }), {
            status,
          }),
        ),
      );
      await expect(membersApi.search("member")).rejects.toMatchObject({
        code: "SAFE_ERROR",
        status,
      });
    },
  );
  it.each([
    { items: [], page: 0, pageSize: 20, total: 0 },
    { items: [{ id: "x" }], page: 1, pageSize: 20, total: 0 },
    { items: [], page: 1, pageSize: 10, total: 0 },
    { items: [], page: 1, pageSize: 20, total: -1 },
    { items: [], page: 1, pageSize: 20, total: 0.5 },
    null,
  ])("rejects malformed successful responses %j", async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
    );
    await expect(membersApi.search("member")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    "rejects unsafe page %s without a request",
    async (page) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(membersApi.search("member", page)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("distinguishes network loss and an aborted lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("transport details")),
    );
    await expect(membersApi.search("member")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      membersApi.search("member", undefined, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
