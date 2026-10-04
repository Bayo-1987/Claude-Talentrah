import { Button, NairaAmount } from "@/components/ui";
import { cancelAutoRenewAction, initiatePurchaseAction } from "@/lib/billing/actions";
import { formatDate } from "@/lib/format/datetime";
import { passDateLine, passOverlapNotice, type PackRow, type PassProductRow, type PassSplit, type UserPassRow } from "@/lib/billing/billing-view";

type PackRowWithPrice = PackRow & { price_ngn: number };
import { passTiming } from "@/lib/passes/pass-timing";
import { PassOverlapNotice } from "@/components/billing/pass-overlap-notice";

/**
 * What each credit pack's price is worth in plain terms, keyed by name, matching scripts/seed.ts's own two packs. "Credits never expire" is
 * a verified claim, not marketing copy: grep src/lib/credits/ finds no expiry logic anywhere, and this line only exists because of that
 * check. If that ever stops being true, this line has to go with it.
 */
const PACK_DESCRIPTION: Record<string, string> = {
  Starter: "1 resume tailoring · credits never expire",
  Plus: "2 tailorings + a cover letter, or a Directory verification · never expire",
};

const COLUMN_HEADING = "font-body text-[11px] font-bold uppercase tracking-[0.14em] text-line";
const COLUMN =
  "flex flex-col gap-3 border-t border-ink-line pt-5 first:border-t-0 first:pt-0 @[700px]:border-l @[700px]:border-t-0 @[700px]:px-7 @[700px]:pt-0 @[700px]:first:border-l-0 @[700px]:first:pl-0 @[700px]:last:pr-0";
const FOCUS_ON_DARK = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper";

function CancelForm({ pass }: { pass: UserPassRow }) {
  return (
    <form action={cancelAutoRenewAction.bind(null, pass.id)}>
      <Button type="submit" variant="onDarkText" size="sm">
        Cancel auto-renewal
      </Button>
    </form>
  );
}

function PassNotice({ notice }: { notice: ReturnType<typeof passDateLine>["notice"] }) {
  if (notice === "reminder") return <p className="text-[13px] text-line">You&apos;ll get a reminder before you&apos;re charged.</p>;
  if (notice === "canceled") {
    return <p className="text-[13px] text-line">Auto-renewal canceled — access continues until it expires, then this Pass won&apos;t renew.</p>;
  }
  if (notice === "lapsed") {
    return (
      <p className="border-[1.5px] border-rust bg-rust-soft px-3 py-2 text-[13px] text-ink">
        A renewal charge failed, so this Pass won&apos;t auto-renew. Buy a new one below to keep access after it expires.
      </p>
    );
  }
  return null;
}

function RunningPass({ pass, others, now }: { pass: UserPassRow; others: UserPassRow[]; now: number }) {
  const timing = passTiming(pass.started_at, pass.expires_at, now);
  const line = passDateLine(pass);
  const name = pass.passes?.name ?? "Your Pass";
  const pct = Math.round((timing.daysUsed / timing.totalDays) * 100);
  return (
    <>
      <p className="font-display text-[30px] leading-[1.1]">{name}</p>
      <div
        role="progressbar"
        aria-label={`Days of your ${name} used`}
        aria-valuemin={0}
        aria-valuemax={timing.totalDays}
        aria-valuenow={timing.daysUsed}
        aria-valuetext={`${timing.daysUsed} of ${timing.totalDays} days used`}
        className="h-2 bg-ink-line"
      >
        <div className="h-full bg-paper" style={{ width: `${pct}%` }} />
      </div>
      <p className="flex flex-wrap justify-between gap-x-3 text-[13.5px]">
        <span className="text-line">{`${timing.daysLeft} ${timing.daysLeft === 1 ? "day" : "days"} left`}</span>
        <span>{line.text}</span>
      </p>
      <PassNotice notice={line.notice} />
      {line.canCancel && <CancelForm pass={pass} />}
      {others.length > 0 && (
        <details className="text-[13.5px]">
          <summary className={`inline-flex min-h-11 cursor-pointer items-center text-line underline underline-offset-2 ${FOCUS_ON_DARK}`}>
            {`${others.length} other active ${others.length === 1 ? "pass" : "passes"}`}
          </summary>
          <ul className="mt-1 flex list-none flex-col gap-3 p-0">
            {others.map((o) => {
              const l = passDateLine(o);
              return (
                <li key={o.id} className="flex flex-col gap-1 border-t border-ink-line pt-3">
                  <span className="font-semibold">{o.passes?.name ?? "Pass"}</span>
                  <span className="text-line">{l.text}</span>
                  {l.canCancel && <CancelForm pass={o} />}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 border-t border-ink-line pt-3">
            <PassOverlapNotice text={passOverlapNotice(pass)} onDark />
          </div>
        </details>
      )}
    </>
  );
}

function NoPass({ split, lowest }: { split: PassSplit; lowest: PassProductRow | null }) {
  return (
    <>
      <p className="font-display text-[30px] leading-[1.1]">None active</p>
      {split.lastEnded && (
        <p className="text-[13.5px] text-line">{`Your ${split.lastEnded.passes?.name ?? "Pass"} ended ${formatDate(split.lastEnded.expires_at)}.`}</p>
      )}
      <p className="text-[13.5px] text-line">
        {"A pass covers tailoring, cover letters, bullet rewrites, Auto-Apply, scholarship checks and SOP drafts at zero credit cost. "}
        {lowest && (
          <>
            {"From "}
            <NairaAmount amount={lowest.price_ngn} />
            {` for ${lowest.duration_days} days.`}
          </>
        )}
      </p>
      <a href="#passes" className={`inline-flex min-h-11 items-center self-start font-semibold text-paper underline underline-offset-2 ${FOCUS_ON_DARK}`}>
        See passes
      </a>
    </>
  );
}

/**
 * The ink panel that leads the page: balance, pass, top up (three columns on a wide screen, stacked on a phone).
 * Colours on ink are paper, line and rust-soft only: rust, green, amber and ink-soft all fall below 4.5:1 on it.
 * With no credits, the top-up column moves above the pass on a phone, so the way to add some is the next thing after the 0.
 */
export function BalancePanel({
  balance,
  packs,
  split,
  lowestPass,
  now,
}: {
  balance: number;
  packs: readonly PackRowWithPrice[];
  split: PassSplit;
  lowestPass: PassProductRow | null;
  now: number;
}) {
  const empty = balance === 0;
  return (
    <section aria-label="Balance, pass and top-up" className="grid grid-cols-1 gap-5 bg-ink px-5 py-6 text-paper @[560px]:px-9 @[560px]:py-8 @[700px]:grid-cols-[1fr_1.15fr_1fr] @[700px]:gap-0">
      <div className={COLUMN}>
        <h2 className={COLUMN_HEADING}>Your balance</h2>
        <p className="flex items-baseline gap-3 font-display text-[64px] font-medium leading-[0.9] @[560px]:text-[88px]">
          {balance}
          <span className="font-body text-[15px] font-normal text-line">credits</span>
        </p>
      </div>

      <div className={`${COLUMN} ${empty ? "@max-[700px]:order-3" : ""}`}>
        <h2 className={COLUMN_HEADING}>Pass</h2>
        {split.leading ? <RunningPass pass={split.leading} others={split.otherLive} now={now} /> : <NoPass split={split} lowest={lowestPass} />}
      </div>

      <div className={`${COLUMN} ${empty ? "@max-[700px]:order-2" : ""}`}>
        <h2 className={COLUMN_HEADING}>Top up credits</h2>
        {packs.map((pack) => (
          <div key={pack.id} className="flex flex-col gap-1">
            <form action={initiatePurchaseAction.bind(null, "credit_pack", pack.id)}>
              <Button type="submit" variant="onDark" size="md" className="w-full justify-between! gap-3">
                <span>{`${pack.name} · ${pack.credits}`}</span>
                <span data-testid="credit-pack-price" className="font-display text-[19px] font-medium">
                  <NairaAmount amount={pack.price_ngn} />
                </span>
              </Button>
            </form>
            {PACK_DESCRIPTION[pack.name] && <p className="text-[12.5px] text-line">{PACK_DESCRIPTION[pack.name]}</p>}
          </div>
        ))}
        <p className="text-[13px] text-line">Credit packs</p>
      </div>
    </section>
  );
}
