"use client";

import { useActionState } from "react";
import { submitCacVerificationAction, type EmployerActionState } from "@/lib/employer/actions";
import { BorderedCard, Button, TextField, EyebrowLabel } from "@/components/ui";

/**
 * "Path 2" of verification: a CAC business registration number, for an
 * employer whose account email cannot verify the org by domain match
 * (0116/0120).
 *
 * Reflects three states honestly rather than always showing the form, same
 * spirit as the domain verification note above it on this page:
 *
 *   confirmed   an admin already matched this against the CAC public
 *               register. Read-only — resubmitting would not do anything;
 *               only an admin decision changes `verified`.
 *   pending     submitted, not yet decided. Editable, so a typo can be fixed
 *               before an admin looks at it — this simply overwrites the
 *               earlier submission, which is fine because nothing is decided
 *               until admin review.
 *   none        nothing submitted yet.
 */
export function CacVerificationForm({
  initial,
  status,
}: {
  initial: { cacNumber: string; cacBusinessName: string };
  status: "confirmed" | "pending" | "none";
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(
    submitCacVerificationAction,
    null,
  );
  const error = state && "error" in state ? state.error : null;
  const saved = state && "ok" in state;

  return (
    <div className="flex flex-col gap-4">
      <EyebrowLabel>Verify by CAC registration</EyebrowLabel>
      <p className="max-w-[60ch] font-body text-[13.5px] text-ink-soft">
        If your account email isn&apos;t on your company&apos;s domain, submit your CAC (Corporate
        Affairs Commission) business registration number instead. An admin confirms it against the
        public register by hand — this is not automatic and does not verify you immediately.
      </p>

      {status === "confirmed" ? (
        <BorderedCard className="p-5">
          <p className="font-display text-[15px] italic text-ink-soft">
            Confirmed — RC number {initial.cacNumber}, registered as “{initial.cacBusinessName}”.
          </p>
        </BorderedCard>
      ) : (
        <>
          {error && (
            <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-ink">
              Submitted. An admin will confirm it against the public register.
            </p>
          )}
          {status === "pending" && !saved && (
            <p className="font-display text-[13.5px] italic text-ink-soft">
              Submitted and awaiting review — you can correct and resubmit below.
            </p>
          )}

          <BorderedCard className="p-6">
            <form action={formAction} className="flex flex-col gap-5">
              <TextField
                label="Registered business name"
                name="cacBusinessName"
                required
                defaultValue={initial.cacBusinessName}
                placeholder="Exactly as registered with the CAC"
              />
              <TextField
                label="RC number"
                name="cacNumber"
                required
                defaultValue={initial.cacNumber}
                placeholder="e.g. RC1234567"
              />
              <div>
                <Button type="submit" disabled={pending}>
                  {pending ? "Submitting…" : status === "pending" ? "Resubmit" : "Submit for review"}
                </Button>
              </div>
            </form>
          </BorderedCard>
        </>
      )}
    </div>
  );
}
