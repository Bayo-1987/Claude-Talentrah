"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { formatDate } from "@/lib/format/datetime";
import type { ExtendResult } from "@/lib/jobs/expiry-reminders/extend";
import { extendPostingAction } from "./actions";
import { refusalCopy } from "./copy";

/**
 * The confirm button. Posting this form is what extends the posting — opening the page never does. It names the job and
 * shows the date it closes on now and the date it will close on, before the button.
 */
export function ExtendForm({
  token,
  title,
  closesAt,
  newClosesAt,
}: {
  token: string;
  title: string;
  closesAt: string;
  newClosesAt: string;
}) {
  const [result, submit] = useActionState<ExtendResult | null, FormData>(
    async () => extendPostingAction(token),
    null,
  );

  if (result?.outcome === "extended") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[32px] leading-[1.25]">Extended.</h1>
        <p className="text-[15.5px] text-ink-soft">
          <strong>{result.title}</strong> now closes on {formatDate(result.newExpiresAt)}. We&apos;ll remind you again
          before then.
        </p>
        <Link href="/employer/jobs" className="font-body text-[15px] font-semibold text-rust">
          Go to Jobs Posted
        </Link>
      </div>
    );
  }

  const refusal = result
    ? refusalCopy({ outcome: result.outcome, closesAt: result.outcome === "used" ? result.closesAt : undefined })
    : null;

  return (
    <form action={submit} className="flex flex-col items-start gap-4">
      <h1 className="text-[32px] leading-[1.25]">Keep this posting open?</h1>
      <p className="text-[15.5px] text-ink-soft">
        <strong>{title}</strong> closes on {formatDate(closesAt)}. Extending moves it to {formatDate(newClosesAt)}. It
        is free.
      </p>
      <Button type="submit">Extend 30 days</Button>
      {refusal && (
        <p className="text-[14.5px] text-rust" role="alert">
          <strong>{refusal.heading}</strong> {refusal.body}
        </p>
      )}
    </form>
  );
}
