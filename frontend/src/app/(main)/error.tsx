"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main>
      <section role="alert">
        <h1>Unable to load this page</h1>
        <p>Try loading again or return to your meetings.</p>
        <Button type="button" onClick={reset}>
          Try again
        </Button>{" "}
        <Link href="/dashboard">Back to meetings</Link>
      </section>
    </main>
  );
}
