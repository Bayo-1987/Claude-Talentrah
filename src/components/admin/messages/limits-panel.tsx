import { BorderedCard, EyebrowLabel } from "@/components/ui";
import type { EmailLimits } from "@/lib/admin/messages/reads";
import { LimitForm } from "./limit-form";
import type { MessageAction } from "./action-form";
import { RAISING_A_LIMIT_NOTE } from "./texts";

/**
 * Mass email limits. Everyone who can open the page sees the numbers; only a Super Admin (the operators permission) gets the forms. The server action re-checks, so a hidden form
 * is a courtesy, not the control.
 */
export function LimitsPanel({ limits, queued, canEdit, setLimit }: { limits: EmailLimits; queued: number; canEdit: boolean; setLimit: MessageAction }) {
  return (
    <BorderedCard className="flex flex-col gap-4 p-5">
      <EyebrowLabel>Mass email limits</EyebrowLabel>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[14.5px] sm:grid-cols-3">
        <div><dt className="text-ink-soft">24-hour cap</dt><dd data-testid="cap">{limits.cap24h}</dd></div>
        <div><dt className="text-ink-soft">Sent in the last 24 hours</dt><dd>{limits.sentLast24h}</dd></div>
        <div><dt className="text-ink-soft">Monthly ceiling</dt><dd data-testid="ceiling">{limits.ceilingMonth}</dd></div>
        <div><dt className="text-ink-soft">Sent this month (UTC)</dt><dd>{limits.sentThisMonth}</dd></div>
        <div><dt className="text-ink-soft">Queued</dt><dd>{queued}</dd></div>
      </dl>
      <p className="text-[13.5px] text-ink-soft">At a limit, mass email pauses and the rest stay queued. It never sends anyway. {RAISING_A_LIMIT_NOTE}</p>
      {canEdit ? (
        <div className="flex flex-wrap gap-6">
          <LimitForm settingKey="mass_email_cap_24h" label="24-hour cap" value={limits.cap24h} action={setLimit} />
          <LimitForm settingKey="mass_email_ceiling_month" label="Monthly ceiling" value={limits.ceilingMonth} action={setLimit} />
        </div>
      ) : (
        <p className="font-display text-[14px] italic text-ink-soft">Only a Super Admin can change these limits.</p>
      )}
    </BorderedCard>
  );
}
