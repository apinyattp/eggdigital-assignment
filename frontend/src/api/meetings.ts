import { isRecord } from "@/utils/typeGuards";
import { meetingJoinUrl } from "@/utils/meetingLinks";
import { publicConfig } from "@/config/public";

export type MeetingStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";
export type CreateOnsiteRequest = {
  requestId: string;
  title: string;
  candidateName: string;
  candidateEmail: string;
  position: string;
  startsAt: string;
  endsAt: string;
  attendeeMemberIds: readonly string[];
  description?: string | null;
  preparationNotes?: string | null;
  location?: string | null;
  status?: Exclude<MeetingStatus, "CANCELLED">;
  format?: "ONSITE";
};
export type CreateOnlineRequest = Omit<CreateOnsiteRequest, "format"> & {
  format: "ONLINE";
  joinUrl: string;
};
export type CreateMeetingRequest = CreateOnsiteRequest | CreateOnlineRequest;
export type EditMeetingRequest = {
  joinUrl?: string;
  expectedUpdatedAt: string;
  title?: string;
  candidateName?: string;
  candidateEmail?: string;
  position?: string;
  description?: string | null;
  preparationNotes?: string | null;
  location?: string | null;
  status?: MeetingStatus;
  attendeeChanges?: {
    addMemberIds: readonly string[];
    removeEmails: readonly string[];
  };
};
export type TeamChangeRequest = {
  expectedUpdatedAt: string;
  addMemberIds: readonly string[];
  removeEmails: readonly string[];
};
export type Meeting = {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  preparationNotes: string | null;
  candidate: { name: string; email: string };
  position: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  location: string | null;
  attendees: { memberId: string | null; displayName: string; email: string }[];
  createdAt: string;
  updatedAt: string;
  joinUrl?: string | null;
} & (
  | { format: "ONSITE"; meetingProvider: null; externalMeetingId: null }
  | {
      format: "ONLINE";
      meetingProvider: "GOOGLE_MEET" | "ZOOM" | null;
      externalMeetingId: string | null;
    }
);

export class MeetingError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly fields: Record<string, string> = {},
  ) {
    super(code);
    this.name = "MeetingError";
  }
}

function parseMeeting(value: unknown, status: number): Meeting {
  const invalid = () => new MeetingError("INVALID_RESPONSE", status);
  if (!isRecord(value) || !isRecord(value.meeting)) {
    throw invalid();
  }
  const meeting = value.meeting;
  const strings = [
    "id",
    "creatorId",
    "title",
    "position",
    "startsAt",
    "endsAt",
    "createdAt",
    "updatedAt",
  ] as const;
  if (
    strings.some((key) => typeof meeting[key] !== "string") ||
    !(
      typeof meeting.description === "string" || meeting.description === null
    ) ||
    !(
      typeof meeting.preparationNotes === "string" ||
      meeting.preparationNotes === null
    ) ||
    !(typeof meeting.location === "string" || meeting.location === null) ||
    !isRecord(meeting.candidate) ||
    typeof meeting.candidate.name !== "string" ||
    typeof meeting.candidate.email !== "string" ||
    !(
      meeting.status === "PENDING" ||
      meeting.status === "CONFIRMED" ||
      meeting.status === "REJECTED" ||
      meeting.status === "CANCELLED"
    ) ||
    !(meeting.format === "ONSITE"
      ? meeting.meetingProvider === null && meeting.externalMeetingId === null
      : meeting.format === "ONLINE" &&
        ((meeting.meetingProvider === null &&
          meeting.externalMeetingId === null) ||
          ((meeting.meetingProvider === "GOOGLE_MEET" ||
            meeting.meetingProvider === "ZOOM") &&
            typeof meeting.externalMeetingId === "string" &&
            meeting.externalMeetingId.length > 0))) ||
    !Array.isArray(meeting.attendees)
  ) {
    throw invalid();
  }
  const attendees = meeting.attendees.map((attendee: unknown) => {
    if (
      !isRecord(attendee) ||
      !(typeof attendee.memberId === "string" || attendee.memberId === null) ||
      typeof attendee.displayName !== "string" ||
      typeof attendee.email !== "string"
    ) {
      throw invalid();
    }
    return {
      memberId: attendee.memberId,
      displayName: attendee.displayName,
      email: attendee.email,
    };
  });
  // Keep server timestamps and stored text verbatim. This adapter does not impose
  // date precision, field projection or new business validation on the form.
  const channel =
    meeting.format === "ONLINE"
      ? {
          format: "ONLINE" as const,
          meetingProvider: meeting.meetingProvider as
            "GOOGLE_MEET" | "ZOOM" | null,
          externalMeetingId: meeting.externalMeetingId as string | null,
        }
      : {
          format: "ONSITE" as const,
          meetingProvider: null,
          externalMeetingId: null,
        };
  return {
    ...channel,
    ...(meeting.joinUrl !== undefined
      ? {
          joinUrl: meetingJoinUrl(
            meeting.joinUrl,
            channel.format,
            String(meeting.status),
          ),
        }
      : {}),
    id: meeting.id as string,
    creatorId: meeting.creatorId as string,
    title: meeting.title as string,
    description: meeting.description,
    preparationNotes: meeting.preparationNotes,
    candidate: { name: meeting.candidate.name, email: meeting.candidate.email },
    position: meeting.position as string,
    startsAt: meeting.startsAt as string,
    endsAt: meeting.endsAt as string,
    status: meeting.status,
    location: meeting.location,
    attendees,
    createdAt: meeting.createdAt as string,
    updatedAt: meeting.updatedAt as string,
  };
}

async function request(
  path: string,
  body?:
    | CreateMeetingRequest
    | EditMeetingRequest
    | TeamChangeRequest
    | { expectedUpdatedAt: string },
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(
      `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/meetings${path}`,
      {
        method: body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
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
        ...(signal ? { signal } : {}),
      },
    );
  } catch {
    throw new MeetingError("NETWORK_ERROR");
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(value) && isRecord(value.error) ? value.error : null;
    const fields =
      error && isRecord(error.fields)
        ? Object.fromEntries(
            Object.entries(error.fields).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          )
        : {};
    throw new MeetingError(
      typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
      response.status,
      fields,
    );
  }
  if (
    body && path === ""
      ? response.status !== 200 && response.status !== 201
      : response.status !== 200
  ) {
    throw new MeetingError("INVALID_RESPONSE", response.status);
  }
  const meeting = parseMeeting(value, response.status);
  return {
    meeting,
    created: response.status === 201,
  };
}

export const meetingsApi = {
  create: (body: CreateMeetingRequest) => request("", body),
  edit: async (meetingId: string, body: EditMeetingRequest) =>
    (await request(`/${encodeURIComponent(meetingId)}/edit`, body)).meeting,
  team: async (meetingId: string, body: TeamChangeRequest) =>
    (await request(`/${encodeURIComponent(meetingId)}/team`, body)).meeting,
  cancel: async (meetingId: string, expectedUpdatedAt: string) =>
    (
      await request(`/${encodeURIComponent(meetingId)}/cancel`, {
        expectedUpdatedAt,
      })
    ).meeting,
  async delete(
    meetingId: string,
    expectedUpdatedAt: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/meetings/${encodeURIComponent(meetingId)}/delete`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "MeetingManager",
          },
          body: JSON.stringify({ expectedUpdatedAt }),
        },
      );
    } catch {
      throw new MeetingError("NETWORK_ERROR");
    }
    if (response.status === 204) {
      return;
    }
    const value: unknown = await response.json().catch(() => null);
    const error = isRecord(value) && isRecord(value.error) ? value.error : null;
    if (!response.ok) {
      throw new MeetingError(
        typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
        response.status,
      );
    }
    throw new MeetingError("INVALID_RESPONSE", response.status);
  },
  read: async (meetingId: string, signal?: AbortSignal) =>
    (await request(`/${encodeURIComponent(meetingId)}`, undefined, signal))
      .meeting,
};
