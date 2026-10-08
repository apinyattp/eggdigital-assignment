import { isRecord } from "@/utils/typeGuards";
import { publicConfig } from "@/config/public";
import { MeetingError } from "./meetings";
import { parseMeetingSummary, type MeetingSummary } from "./meetingSummary";

export type MeetingGroup = { count: number; items: MeetingSummary[] };
export type CurrentMeetingGroup = {
  items: MeetingSummary[];
  page: number;
  pageSize: number;
  total: number;
};
export type MeetingList = {
  date: string;
  timeZone: "Asia/Bangkok";
  referenceTime: string;
  snapshot: string;
  groups: {
    upcomingCurrent: CurrentMeetingGroup;
    rejectedCancelled: MeetingGroup;
    past: MeetingGroup;
  };
};
export type MeetingListBatch = Pick<
  MeetingList,
  "date" | "timeZone" | "referenceTime" | "snapshot"
> & {
  section: "upcomingCurrent";
  group: CurrentMeetingGroup;
};
function parseCappedMeetingGroup(
  value: unknown,
  maximum: number,
  status: number,
): MeetingGroup {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.count) ||
    (value.count as number) < 0 ||
    !Array.isArray(value.items) ||
    value.items.length > maximum ||
    value.items.length > (value.count as number)
  ) {
    throw new MeetingError("INVALID_RESPONSE", status);
  }
  const items = value.items.map((item) => parseMeetingSummary(item, status));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new MeetingError("INVALID_RESPONSE", status);
  }
  return { count: value.count as number, items };
}
function parseCurrentMeetingPage(
  value: unknown,
  page: number,
  status: number,
): CurrentMeetingGroup {
  if (
    !isRecord(value) ||
    value.page !== page ||
    value.pageSize !== 10 ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0
  ) {
    throw new MeetingError("INVALID_RESPONSE", status);
  }
  const result = parseCappedMeetingGroup(
    { count: value.total, items: value.items },
    10,
    status,
  );
  return { items: result.items, page, pageSize: 10, total: result.count };
}
async function fetchValidatedMeetingListResponse(
  date: string,
  page: number,
  snapshot?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    date,
    page: String(page),
    pageSize: "10",
  });
  if (snapshot !== undefined) {
    query.set("section", "upcomingCurrent");
    query.set("snapshot", snapshot);
  }
  let response: Response;
  try {
    response = await fetch(
      `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/meetings?${query}`,
      {
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal,
      },
    );
  } catch {
    throw new MeetingError("NETWORK_ERROR");
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MeetingError(
      isRecord(value) &&
        isRecord(value.error) &&
        typeof value.error.code === "string"
        ? value.error.code
        : "REQUEST_FAILED",
      response.status,
    );
  }
  if (
    response.status !== 200 ||
    !isRecord(value) ||
    value.date !== date ||
    value.timeZone !== "Asia/Bangkok" ||
    typeof value.referenceTime !== "string" ||
    !Number.isFinite(Date.parse(value.referenceTime)) ||
    typeof value.snapshot !== "string" ||
    !value.snapshot
  ) {
    throw new MeetingError("INVALID_RESPONSE", response.status);
  }
  return {
    value,
    status: response.status,
    date,
    timeZone: "Asia/Bangkok" as const,
    referenceTime: value.referenceTime,
    snapshot: value.snapshot,
  };
}
export const meetingListApi = {
  async read(date: string, signal?: AbortSignal): Promise<MeetingList> {
    const { value, status, ...header } =
      await fetchValidatedMeetingListResponse(date, 1, undefined, signal);
    if (!isRecord(value.groups)) {
      throw new MeetingError("INVALID_RESPONSE", status);
    }
    const groups = {
      upcomingCurrent: parseCurrentMeetingPage(
        value.groups.upcomingCurrent,
        1,
        status,
      ),
      rejectedCancelled: parseCappedMeetingGroup(
        value.groups.rejectedCancelled,
        5,
        status,
      ),
      past: parseCappedMeetingGroup(value.groups.past, 5, status),
    };
    const ids = Object.values(groups).flatMap((group) =>
      group.items.map((item) => item.id),
    );
    if (new Set(ids).size !== ids.length) {
      throw new MeetingError("INVALID_RESPONSE", status);
    }
    return { ...header, groups };
  },
  async more(
    date: string,
    page: number,
    snapshot: string,
    signal?: AbortSignal,
  ): Promise<MeetingListBatch> {
    const { value, status, ...header } =
      await fetchValidatedMeetingListResponse(date, page, snapshot, signal);
    if (value.section !== "upcomingCurrent") {
      throw new MeetingError("INVALID_RESPONSE", status);
    }
    return {
      ...header,
      section: "upcomingCurrent",
      group: parseCurrentMeetingPage(value.group, page, status),
    };
  },
};
