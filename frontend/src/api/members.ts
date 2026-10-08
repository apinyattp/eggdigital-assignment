import { publicConfig } from "@/config/public";

export type Member = { id: string; displayName: string; email: string };
export type MemberPage = {
  items: Member[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export class MemberLookupError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "MemberLookupError";
  }
}

export const membersApi = {
  async search(
    query: string,
    page = 1,
    signal?: AbortSignal,
  ): Promise<MemberPage> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger((page - 1) * 20)
    )
      throw new MemberLookupError("VALIDATION_ERROR");
    const trimmed = query.trim();
    if (!trimmed)
      return { items: [], page, pageSize: 20, total: 0, totalPages: 0 };
    const params = new URLSearchParams({
      query: trimmed,
      page: String(page),
      pageSize: "20",
    });
    let response: Response;
    try {
      response = await fetch(
        `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/members?${params}`,
        {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal,
        },
      );
    } catch {
      throw new MemberLookupError(
        signal?.aborted ? "CANCELLED" : "NETWORK_ERROR",
      );
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        value &&
        typeof value === "object" &&
        "error" in value &&
        value.error &&
        typeof value.error === "object" &&
        "code" in value.error &&
        typeof value.error.code === "string"
          ? value.error.code
          : "REQUEST_FAILED";
      throw new MemberLookupError(code, response.status);
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("items" in value) ||
      !Array.isArray(value.items) ||
      !("page" in value) ||
      value.page !== page ||
      !("pageSize" in value) ||
      value.pageSize !== 20 ||
      !("total" in value) ||
      typeof value.total !== "number" ||
      !Number.isSafeInteger(value.total) ||
      value.total < 0 ||
      ("totalPages" in value && value.totalPages !== Math.ceil(value.total / 20)) ||
      value.items.length > 20
    ) {
      throw new MemberLookupError("INVALID_RESPONSE");
    }
    const items = value.items.map((item: unknown): Member => {
      if (
        !item ||
        typeof item !== "object" ||
        !("id" in item) ||
        typeof item.id !== "string" ||
        !("displayName" in item) ||
        typeof item.displayName !== "string" ||
        !("email" in item) ||
        typeof item.email !== "string"
      ) {
        throw new MemberLookupError("INVALID_RESPONSE");
      }
      return { id: item.id, displayName: item.displayName, email: item.email };
    });
    return {
      items,
      page,
      pageSize: 20,
      total: value.total,
      totalPages:
        "totalPages" in value
          ? (value.totalPages as number)
          : Math.ceil(value.total / 20),
    };
  },
};
