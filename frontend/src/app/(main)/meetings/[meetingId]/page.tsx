import { MeetingDetail } from "./_components/MeetingDetail";
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ meetingId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { meetingId } = await params;
  const { date } = await searchParams;
  const returnDate =
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
      ? date
      : undefined;
  return <MeetingDetail meetingId={meetingId} returnDate={returnDate} />;
}
