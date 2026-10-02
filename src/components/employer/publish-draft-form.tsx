"use client";

import { useActionState } from "react";
import { buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DEFAULT_NEW_POSTING_EXPIRY_DAYS } from "@/lib/employer/expiry-input";
import { publishDraftFormAction, type PublishDraftResult } from "@/lib/employer/actions";

/**
 * The Publish button on a draft row.
 *
 * Usually this is just a button. When the draft's closing date is one the employer CHOSE and it has passed (or is under
 * 3 days away), the server refuses to publish and says so (EMP-1 / E3), and this shows that message with a closing-date
 * control, "30 days" preselected, so the next click publishes with a date they have just picked. The date control is not
 * rendered until then: the first click posts no `expiresIn`, which is what lets the server keep a date that is fine.
 */
const CHOICES = [
  { value: "7", label: "7 days" },
  { value: "14", label: "2 weeks" },
  { value: String(DEFAULT_NEW_POSTING_EXPIRY_DAYS), label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "", label: "No expiry" },
] as const;

export function PublishDraftForm({ jobId }: { jobId: string }) {
  const [state, formAction, pending] = useActionState<PublishDraftResult | null, FormData>(
    publishDraftFormAction.bind(null, jobId),
    null,
  );
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      {error && (
        <div className="flex flex-col items-end gap-2" role="alert">
          <p className="max-w-[280px] text-right font-body text-[13px] text-rust">{error}</p>
          <label htmlFor={`publish-closes-${jobId}`} className="sr-only">
            Closes
          </label>
          <select
            id={`publish-closes-${jobId}`}
            name="expiresIn"
            defaultValue={String(DEFAULT_NEW_POSTING_EXPIRY_DAYS)}
            className={cn(
              "min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust",
            )}
          >
            {CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" disabled={pending} className={buttonClasses("primary", "sm")}>
        {pending ? "Publishing…" : "Publish"}
      </button>
    </form>
  );
}
