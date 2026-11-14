import { BorderedCard, EyebrowLabel } from "@/components/ui";
import type { StaleClaimRow } from "@/lib/notifications/contract";
import { ActionForm, type MessageAction } from "./action-form";
import { STALE_CLAIM_EXPLAINER } from "./texts";

/** Open email claims older than 30 minutes: an id and a time per row. No person, no address. */
export function StaleClaimsPanel({ claims, resolve }: { claims: StaleClaimRow[]; resolve: MessageAction }) {
  return (
    <BorderedCard className="flex flex-col gap-4 p-5">
      <EyebrowLabel>Emails with an unknown result</EyebrowLabel>
      <p className="text-[13.5px] text-ink-soft">{STALE_CLAIM_EXPLAINER}</p>
      {claims.length === 0 ? (
        <p className="font-display text-[14px] italic text-ink-soft">None. Every email has a result.</p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-6 border-t border-line pt-3">
              <p className="text-[13.5px]">Claimed {c.claimed_at.slice(0, 16).replace("T", " ")} UTC</p>
              <ActionForm action={resolve} targetId={c.id} hidden={{ claimId: c.id, resolution: "mark_sent" }} label="Mark sent" variant="secondary" />
              <ActionForm action={resolve} targetId={c.id} hidden={{ claimId: c.id, resolution: "release_for_retry" }} label="Release for retry" variant="secondary" />
            </li>
          ))}
        </ul>
      )}
    </BorderedCard>
  );
}
