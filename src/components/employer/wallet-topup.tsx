"use client";

import { useActionState } from "react";
import { Button, TextField } from "@/components/ui";
import type { EmployerActionState } from "@/lib/employer/actions";

const PRESETS = [10_000, 25_000, 50_000] as const;
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export function WalletTopUp({
  action,
  balanceNgn,
  dailyCommitmentNgn,
}: {
  action: (state: EmployerActionState, form: FormData) => Promise<EmployerActionState>;
  balanceNgn: number;
  /** Sum of the daily rates of everything currently running. */
  dailyCommitmentNgn: number;
}) {
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(action, null);
  const error = state && "error" in state ? state.error : null;

  // Days of runway at the CURRENT commitment. Shown because a balance on its
  // own does not answer the only question an advertiser has — "when does this
  // stop?" — and because campaigns pause rather than warn when it runs out.
  const daysLeft =
    dailyCommitmentNgn > 0 ? Math.floor(balanceNgn / dailyCommitmentNgn) : null;

  return (
    <div className="flex flex-col gap-3 border-y border-line py-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-body text-[13px] font-semibold text-ink-soft">Ad wallet</span>
        <span className="font-display text-[22px] font-medium text-ink">{naira(balanceNgn)}</span>
        <span className="font-body text-[13px] text-ink-soft">
          {daysLeft === null ? (
            <>— campaigns draw from this, separately from your Talentrah credits.</>
          ) : daysLeft === 0 ? (
            <>
              — <strong className="text-rust">not enough for another day</strong> at{" "}
              {naira(dailyCommitmentNgn)}/day. Running campaigns will pause.
            </>
          ) : (
            <>
              — about <strong>{daysLeft}</strong> more {daysLeft === 1 ? "day" : "days"} at{" "}
              {naira(dailyCommitmentNgn)}/day across your running campaigns.
            </>
          )}
        </span>
      </div>

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {error}
        </p>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <div className="w-[200px]">
          <TextField
            label="Top up (₦)"
            name="amount"
            type="number"
            min={1000}
            step={1000}
            required
            placeholder="10000"
          />
        </div>
        <Button type="submit" disabled={pending}>
          {/*
            Named for what happens next, not for the outcome. The click leaves
            for Paystack; the wallet is credited only once payment confirms, and
            a button reading "Add funds" would promise the second thing while
            doing the first.
          */}
          {pending ? "Opening Paystack…" : "Continue to Paystack"}
        </Button>
        <span className="font-body text-[12.5px] text-ink-soft">
          Card, bank transfer or USSD. Minimum {naira(1000)}.
        </span>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <form key={p} action={formAction}>
            <input type="hidden" name="amount" value={p} />
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 border-[1.5px] border-ink bg-transparent px-4 font-body text-[13.5px] font-semibold text-ink hover:border-rust hover:text-rust disabled:opacity-50"
            >
              {naira(p)}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
