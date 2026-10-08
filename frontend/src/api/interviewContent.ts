import { publicConfig } from "@/config/public";
import { isRecord, isNullableString } from "@/utils/typeGuards";

export type InterviewNote = { text: string; updatedAt: string };
export type NoteSave = { text: string; expectedUpdatedAt: string | null };
export type Feedback = {
  id: string;
  text: string;
  author: { displayName: string };
  isOwn: boolean;
  createdAt: string;
  updatedAt: string;
};
export type FeedbackPage = {
  items: Feedback[];
  ownFeedbackId: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  asOf: string;
  snapshot: string;
};
export type FeedbackCreate = { requestId: string; text: string };
export type FeedbackEdit = { text: string; expectedUpdatedAt: string };
export class InterviewContentError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
    this.name = "InterviewContentError";
  }
}
function parseFeedback(value: unknown, status: number): Feedback {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    typeof value.isOwn !== "boolean" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.author) ||
    typeof value.author.displayName !== "string"
  ) {
    throw new InterviewContentError("INVALID_RESPONSE", status);
  }
  return {
    id: value.id,
    text: value.text,
    author: { displayName: value.author.displayName },
    isOwn: value.isOwn,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
async function request(
  meetingId: string,
  path: string,
  body?: NoteSave | FeedbackCreate | FeedbackEdit,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(
      `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/meetings/${encodeURIComponent(meetingId)}${path}`,
      {
        method: body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal,
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "X-Requested-With": "MeetingManager",
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
  } catch {
    throw new InterviewContentError("NETWORK_ERROR");
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new InterviewContentError(
      isRecord(value) &&
        isRecord(value.error) &&
        typeof value.error.code === "string"
        ? value.error.code
        : "REQUEST_FAILED",
      response.status,
    );
  }
  if (
    (body && path === "/feedback"
      ? response.status !== 200 && response.status !== 201
      : response.status !== 200) ||
    !isRecord(value)
  ) {
    throw new InterviewContentError("INVALID_RESPONSE", response.status);
  }
  return { value, status: response.status };
}
function parseInterviewNote(value: unknown, status: number): InterviewNote {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new InterviewContentError("INVALID_RESPONSE", status);
  }
  return { text: value.text, updatedAt: value.updatedAt };
}
export const interviewContentApi = {
  readNote: async (
    meetingId: string,
    signal?: AbortSignal,
  ): Promise<InterviewNote | null> => {
    const result = await request(meetingId, "/notes/me", undefined, signal);
    return result.value.note === null
      ? null
      : parseInterviewNote(result.value.note, result.status);
  },
  saveNote: async (
    meetingId: string,
    body: NoteSave,
  ): Promise<InterviewNote> => {
    const result = await request(meetingId, "/notes/me", body);
    return parseInterviewNote(result.value.note, result.status);
  },
  readFeedback: async (
    meetingId: string,
    page = 1,
    snapshot?: string,
    signal?: AbortSignal,
  ): Promise<FeedbackPage> => {
    const query = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (snapshot !== undefined) {
      query.set("snapshot", snapshot);
    }
    const result = await request(
      meetingId,
      `/feedback?${query}`,
      undefined,
      signal,
    );
    const {
      items,
      ownFeedbackId,
      total,
      totalPages,
      asOf,
      snapshot: returnedSnapshot,
    } = result.value;
    if (
      !Array.isArray(items) ||
      !isNullableString(ownFeedbackId) ||
      result.value.page !== page ||
      result.value.pageSize !== 50 ||
      !Number.isSafeInteger(total) ||
      (total as number) < 0 ||
      ("totalPages" in result.value &&
        totalPages !== Math.ceil((total as number) / 50)) ||
      items.length > 50 ||
      typeof asOf !== "string" ||
      !Number.isFinite(Date.parse(asOf)) ||
      typeof returnedSnapshot !== "string" ||
      !returnedSnapshot
    ) {
      throw new InterviewContentError("INVALID_RESPONSE", result.status);
    }
    return {
      items: items.map((item) => parseFeedback(item, result.status)),
      ownFeedbackId,
      page,
      pageSize: 50,
      total: total as number,
      totalPages:
        (totalPages as number | undefined) ?? Math.ceil((total as number) / 50),
      asOf,
      snapshot: returnedSnapshot,
    };
  },
  createFeedback: async (
    meetingId: string,
    body: FeedbackCreate,
  ): Promise<{ feedback: Feedback; created: boolean }> => {
    const result = await request(meetingId, "/feedback", body);
    return {
      feedback: parseFeedback(result.value.feedback, result.status),
      created: result.status === 201,
    };
  },
  editFeedback: async (
    meetingId: string,
    feedbackId: string,
    body: FeedbackEdit,
  ): Promise<Feedback> => {
    const result = await request(
      meetingId,
      `/feedback/${encodeURIComponent(feedbackId)}/edit`,
      body,
    );
    return parseFeedback(result.value.feedback, result.status);
  },
};
