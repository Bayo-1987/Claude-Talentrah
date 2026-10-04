import { BorderedCard, Button, NairaAmount } from "@/components/ui";
import { initiatePurchaseAction } from "@/lib/billing/actions";
import { autoApplyFreeRunsPhrase } from "@/lib/auto-apply/limits-copy";
import { PASS_DAILY_ACTION_CAP } from "@/lib/passes/entitlement";
import { perDayNgn } from "@/lib/passes/pass-timing";
import { passDateLine, passOverlapNotice, type PassProductRow, type UserPassRow } from "@/lib/billing/billing-view";
import { PassOverlapNotice } from "@/components/billing/pass-overlap-notice";

/**
 * Pass copy, keyed by name, matching scripts/seed.ts's three passes. A pass the table does not name falls back to a plain sentence from
 * its own duration.
 */
const PASS_HEADLINE: Record<string, string> = {
  "7-Day Sprint Pass": "Unlimited for 7 days",
  "30-Day Pass": "Unlimited for 30 days",
  "90-Day Pass": "Unlimited for 90 days",
};

/**
 * The passes on sale, as cards. The pass that expires last is marked "Current" and shows its renewal or end date.
 *
 * It keeps its Buy button. A second pass starts today and runs ALONGSIDE the first rather than after it (fulfill_credit_pack_or_pass,
 * migration 0159, sets expires_at = now() + duration and never reads existing passes), so the days left on the first are not added on.
 * That is how the purchase has always worked and this component does not change it; whether to warn about it, or to queue instead, is
 * the owner's call. (Importing PASS_DAILY_ACTION_CAP from entitlement.ts is read-only: a constant, no gate logic.)
 */
export function PassCards({ passes, current }: { passes: readonly PassProductRow[]; current: UserPassRow | null }) {
  const currentLine = current ? passDateLine(current).text : null;
  return (
    <>
      {current && <PassOverlapNotice text={passOverlapNotice(current)} />}
      <div className="grid grid-cols-1 gap-4 @[620px]:grid-cols-3">
        {passes.map((pass) => {
          const isCurrent = current?.pass_id === pass.id;
          return (
            <BorderedCard key={pass.id} className={`flex flex-col gap-1.5 p-5 ${isCurrent ? "bg-paper-alt" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-[20px] font-medium">{pass.name}</h3>
                {isCurrent && (
                  <span className="border border-ink px-2 py-px text-[11px] font-semibold uppercase tracking-[0.08em]">Current</span>
                )}
              </div>
              <p className="text-[13px] text-ink-soft">{PASS_HEADLINE[pass.name] ?? `Unlimited access for ${pass.duration_days} days`}</p>
              <p className="font-display text-[34px] leading-[1.1]">
                <NairaAmount amount={pass.price_ngn} />
              </p>
              <p className="text-[13px] text-ink-soft">
                {"about "}
                <NairaAmount amount={perDayNgn(pass.price_ngn, pass.duration_days)} />
                {" a day"}
              </p>
              {isCurrent && currentLine && <p className="text-[13px] text-ink-soft">{currentLine}</p>}
              <form action={initiatePurchaseAction.bind(null, "pass", pass.id)} className="mt-auto pt-2">
                <Button type="submit" size="md" className="w-full">
                  Buy
                </Button>
              </form>
            </BorderedCard>
          );
        })}
      </div>
      <p className="max-w-[760px] text-[13.5px] text-ink-soft">
        Covers tailoring, cover letters, bullet rewrites, Auto-Apply beyond {autoApplyFreeRunsPhrase()}, and scholarship eligibility checks
        and SOP drafts — all at zero credit cost, up to {PASS_DAILY_ACTION_CAP} actions a day. Template unlocks and Talent Directory
        verification are sold separately, credits only. Auto-renews if paid by card; one-time if paid by mobile money.
      </p>
    </>
  );
}
