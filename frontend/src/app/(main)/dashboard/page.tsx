import { AuthLanding } from "./_components/AuthLanding";
import { todayBangkok, validDate } from "./_components/dates";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return (
    <AuthLanding
      initialDate={validDate(date) ? date : todayBangkok()}
      invalidDate={date !== undefined && !validDate(date)}
    />
  );
}
