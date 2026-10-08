"use client";
import { useEffect, useState } from "react";
import { authController } from "./authController";
import { useCurrentIdentity } from "./useAuth";
import { useMemberPicker } from "./useMemberPicker";
import {
  useOnsiteCreate,
  type OnsiteDraft,
  type OnlineDraft,
} from "./useOnsiteCreate";
import type { MeetingStatus } from "@/api/meetings";
import { meetingJoinUrl } from "@/utils/meetingLinks";
import { AuthError } from "@/api/auth/authError";

export function bangkokToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}
export const newOnsiteForm = () => ({
  candidateName: "",
  candidateEmail: "",
  position: "",
  title: "",
  description: "",
  preparationNotes: "",
  location: "",
  joinUrl: "",
  status: "PENDING" as Exclude<MeetingStatus, "CANCELLED">,
  startDate: "",
  endDate: "",
  start: "09:00",
  end: "10:00",
});
export type OnsiteFormValues = ReturnType<typeof newOnsiteForm>;
export function validateOnsiteForm(
  values: OnsiteFormValues,
  memberIds: readonly string[],
  now = new Date(),
) {
  const fields: Record<string, string> = {};
  for (const key of [
    "candidateName",
    "candidateEmail",
    "position",
    "title",
    "startDate",
    "endDate",
    "start",
    "end",
  ] as const)
    if (!values[key].trim()) fields[key] = "This field is required.";
  if (
    values.candidateEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.candidateEmail.trim())
  )
    fields.candidateEmail = "Enter an email in the format name@example.com.";
  if (!memberIds.length)
    fields.attendeeMemberIds = "Select at least one team member.";
  const startsAt = `${values.startDate}T${values.start}:00+07:00`,
    endsAt = `${values.endDate}T${values.end}:00+07:00`;
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt);
  if (!Number.isFinite(start))
    fields.startDate = "Enter a valid start date and time.";
  if (!Number.isFinite(end)) fields.endDate = "Enter a valid end date and time.";
  if (values.startDate < bangkokToday(now))
    fields.startDate = "The start date must be today or later.";
  if (Number.isFinite(end) && end <= now.getTime())
    fields.end = "The end time must be in the future.";
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start)
    fields.end = "The end date and time must be after the start date and time.";
  const payload: OnsiteDraft = {
    title: values.title,
    candidateName: values.candidateName,
    candidateEmail: values.candidateEmail,
    position: values.position,
    description: values.description,
    preparationNotes: values.preparationNotes,
    location: values.location,
    status: values.status,
    format: "ONSITE",
    startsAt,
    endsAt,
    attendeeMemberIds: memberIds,
  };
  return { fields, payload };
}
export function validateOnlineForm(
  values: OnsiteFormValues,
  memberIds: readonly string[],
  now = new Date(),
) {
  const result = validateOnsiteForm(values, memberIds, now);
  const payload: OnlineDraft = {
    ...result.payload,
    format: "ONLINE",
    joinUrl: values.joinUrl.trim(),
  };
  if (!meetingJoinUrl(values.joinUrl.trim(), "ONLINE", "PENDING"))
    result.fields.joinUrl = "Enter a valid HTTPS meeting link.";
  return { fields: result.fields, payload };
}
export function useOnsiteForm() {
  const auth = useCurrentIdentity();
  const save = useOnsiteCreate();
  const picker = useMemberPicker(save.locked);
  const [format, setFormat] = useState<"ONSITE" | "ONLINE">("ONSITE");
  const [dirty, setDirty] = useState(false);
  const [values, setValues] = useState(newOnsiteForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    let owner = authController.getSnapshot().session?.user.id;
    return authController.subscribe(() => {
      const snapshot = authController.getSnapshot();
      const denied =
        snapshot.error instanceof AuthError &&
        (snapshot.error.status === 401 ||
          snapshot.error.status === 403 ||
          snapshot.error.code === "CANDIDATE_DENIED");
      if (
        !snapshot.pending &&
        !snapshot.logoutRequired &&
        (snapshot.status === "checking" ||
          (snapshot.status === "error" && !denied))
      )
        return;
      const next =
        snapshot.status === "authenticated" &&
        !snapshot.pending &&
        !snapshot.logoutRequired
          ? snapshot.session?.user.id
          : null;
      if (owner !== next) {
        owner = next;
        setValues(newOnsiteForm());
        setErrors({});
        setFormat("ONSITE");
        setDirty(false);
      }
    });
  }, []);
  function change<K extends keyof OnsiteFormValues>(
    key: K,
    value: OnsiteFormValues[K],
  ) {
    if (!save.locked) {
      setValues((previous) => ({
        ...previous,
        [key]: value,
        ...(key === "startDate" && previous.endDate && previous.endDate < value
          ? { endDate: "" }
          : {}),
      }));
      setErrors({});
      setDirty(true);
    }
  }
  function submit() {
    if (save.locked) return;
    const memberIds = picker.selected.map((member) => member.id);
    const result =
      format === "ONLINE"
        ? validateOnlineForm(values, memberIds)
        : validateOnsiteForm(values, memberIds);
    setErrors(result.fields);
    if (!Object.keys(result.fields).length) void save.save(result.payload);
  }
  return {
    auth,
    save,
    picker,
    values,
    errors: { ...save.fields, ...errors },
    change,
    submit,
    format,
    dirty: dirty || picker.selected.length > 0,
    changeFormat(next: "ONSITE" | "ONLINE") {
      if (!save.locked) {
        setFormat(next);
        setErrors({});
      }
    },
  };
}
