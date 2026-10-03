"use client";

import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DEFAULT_NEW_POSTING_EXPIRY_DAYS } from "@/lib/employer/expiry-input";
import { publishDraftFormAction, type PublishDraftResult } from "@/lib/employer/actions";

/**
 * The Publish button on a draft row (EMP-1 / E3).
 *
 * Usually this is just a button. What the server answers decides the rest:
 *
 *   the closing date has passed   the message, and a closing-date control with "30 days" preselected. The date is the
 *                                 employer's own, so it is not moved for them; they pick a new one and publish.
 *   under 3 days away             a WARNING, not a block: the real number of days, and two buttons.
 *                                   "Publish anyway"  a submit that posts `confirmShortNotice`; the date is untouched.
 *                                   "Change date"     NOT a submit. It only swaps in the closing-date control, so it
 *                                                     publishes nothing.
 *
 * The date control is not rendered until then: the first click posts no `expiresIn`, which is what lets the server keep
 * a date that is fine and reset one it defaulted.
 */
const CHOICES = [
  { value: "7", label: "7 days" },
  { value: "14", label: "2 weeks" },
  { value: String(DEFAULT_NEW_POSTING_EXPIRY_DAYS), label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "", label: "No expiry" },
] as const;

/** Everything on screen, as a pure function of what the server last said and whether the date is being changed. */
export function PublishDraftView({
  jobId,
  state,
  changingDate,
  pending,
  onChangeDate,
  formAction,
}: {
  jobId: string;
  state: PublishDraftResult | null;
  changingDate: boolean;
  pending: boolean;
  onChangeDate: () => void;
  formAction?: (formData: FormData) => void;
}) {
  const refusal = state && !state.ok && state.kind !== "other" ? state : null;
  const other = state && !state.ok && state.kind === "other" ? state.error : null;
  const warning = refusal?.kind === "soon" && !changingDate;
  const showDateControl = (refusal?.kind === "past") || (refusal?.kind === "soon" && changingDate);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      {refusal && !changingDate && (
        <p className="max-w-[300px] text-right font-body text-[13px] text-rust" role="alert">
          {refusal.error}
        </p>
      )}
      {other && (
        <p className="max-w-[300px] text-right font-body text-[13px] text-rust" role="alert">
          {other}
        </p>
      )}
      {showDateControl && (
        <>
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
        </>
      )}
      {warning ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={onChangeDate} className={buttonClasses("secondary", "sm")}>
            Change date
          </button>
          <button
            type="submit"
            name="confirmShortNotice"
            value="1"
            disabled={pending}
            className={buttonClasses("primary", "sm")}
          >
            Publish anyway
          </button>
        </div>
      ) : (
        <button type="submit" disabled={pending} className={buttonClasses("primary", "sm")}>
          {pending ? "Publishing…" : "Publish"}
        </button>
      )}
    </form>
  );
}

export function PublishDraftForm({ jobId }: { jobId: string }) {
  const [state, formAction, pending] = useActionState<PublishDraftResult | null, FormData>(
    publishDraftFormAction.bind(null, jobId),
    null,
  );
  // "Change date" is local: it publishes nothing. Any new answer from the server resets it.
  const [changing, setChanging] = useState<{ forState: PublishDraftResult | null } | null>(null);
  const changingDate = changing !== null && changing.forState === state;

  return (
    <PublishDraftView
      jobId={jobId}
      state={state}
      changingDate={changingDate}
      pending={pending}
      onChangeDate={() => setChanging({ forState: state })}
      formAction={formAction}
    />
  );
}
