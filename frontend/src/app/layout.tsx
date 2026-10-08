import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Login — Candidate Meeting Scheduler",
  description: "EGG Digital interview workspace",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
