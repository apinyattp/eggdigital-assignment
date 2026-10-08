import { isRecord, isNullableString } from "@/utils/typeGuards";
import { meetingJoinUrl } from "@/utils/meetingLinks";
import { publicConfig } from "@/config/public";
import { MeetingError, type MeetingStatus } from "./meetings";
export type MeetingSummary = {
  id: string;
  title: string;
  candidate: { name: string };
  position: string;
  description: string | null;
  preparationNotes: string | null;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  format: "ONSITE" | "ONLINE";
  joinUrl?: string | null;
  location: string | null;
  organizer: { id: string; displayName: string };
  attendees: { memberId: string | null; displayName: string; email: string }[];
  attendeeCount: number;
};
export const meetingSummaryApi = {
  async read(meetingId: string, signal?: AbortSignal): Promise<MeetingSummary> {
    let response: Response;
    try {
      response = await fetch(
        `${publicConfig.apiBaseUrl.replace(/\/$/, "")}/meetings/${encodeURIComponent(meetingId)}/summary`,
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
    const invalid = () => new MeetingError("INVALID_RESPONSE", response.status);
    if (
      response.status !== 200 ||
      !isRecord(value) ||
      !isRecord(value.meeting)
    ) {
      throw invalid();
    }
    return parseMeetingSummary(value.meeting, response.status);
  },
};

/** R1 list and R4 summary return the same safe core projection. */
export function parseMeetingSummary(
  value: unknown,
  status = 200,
): MeetingSummary {
  if (!isRecord(value)) {
    throw new MeetingError("INVALID_RESPONSE", status);
  }
  const invalid = () => new MeetingError("INVALID_RESPONSE", status);
  const rawMeeting = value;
  if (
    typeof rawMeeting.id !== "string" ||
    typeof rawMeeting.title !== "string" ||
    typeof rawMeeting.position !== "string" ||
    typeof rawMeeting.startsAt !== "string" ||
    typeof rawMeeting.endsAt !== "string" ||
    !isNullableString(rawMeeting.description) ||
    !isNullableString(rawMeeting.preparationNotes) ||
    !isNullableString(rawMeeting.location) ||
    !isRecord(rawMeeting.candidate) ||
    typeof rawMeeting.candidate.name !== "string" ||
    !isRecord(rawMeeting.organizer) ||
    typeof rawMeeting.organizer.id !== "string" ||
    typeof rawMeeting.organizer.displayName !== "string" ||
    (rawMeeting.format !== "ONSITE" && rawMeeting.format !== "ONLINE") ||
    !(
      rawMeeting.status === "PENDING" ||
      rawMeeting.status === "CONFIRMED" ||
      rawMeeting.status === "REJECTED" ||
      rawMeeting.status === "CANCELLED"
    ) ||
    !Number.isSafeInteger(rawMeeting.attendeeCount) ||
    (rawMeeting.attendeeCount as number) < 0 ||
    !Array.isArray(rawMeeting.attendees)
  ) {
    throw invalid();
  }
  const attendees = rawMeeting.attendees.map((value) => {
    if (
      !isRecord(value) ||
      !isNullableString(value.memberId) ||
      typeof value.displayName !== "string" ||
      typeof value.email !== "string"
    ) {
      throw invalid();
    }
    return {
      memberId: value.memberId,
      displayName: value.displayName,
      email: value.email,
    };
  });
  return {
    id: rawMeeting.id,
    title: rawMeeting.title,
    candidate: { name: rawMeeting.candidate.name },
    position: rawMeeting.position,
    description: rawMeeting.description,
    preparationNotes: rawMeeting.preparationNotes,
    startsAt: rawMeeting.startsAt,
    endsAt: rawMeeting.endsAt,
    status: rawMeeting.status,
    format: rawMeeting.format,
    ...(rawMeeting.joinUrl !== undefined
      ? {
          joinUrl: meetingJoinUrl(
            rawMeeting.joinUrl,
            rawMeeting.format,
            rawMeeting.status,
          ),
        }
      : {}),
    location: rawMeeting.location,
    organizer: {
      id: rawMeeting.organizer.id,
      displayName: rawMeeting.organizer.displayName,
    },
    attendees,
    attendeeCount: rawMeeting.attendeeCount as number,
  };
}
