"use client";

import { useState, useTransition } from "react";
import { Button, TextField } from "@/components/ui";
import { setReferralLeaderboardPreferenceAction } from "@/lib/referrals/actions";

/**
 * send-140's opt-in control — the same round-switch affordance
 * AutoApplyToggle already uses (one of the design system's few allowed
 * circular elements), because this is the same shape of decision: off by
 * default, the copy states what turning it on actually does BEFORE the
 * switch moves.
 *
 * Deliberately NOT a `useOptimistic` switch like AutoApplyToggle's — that
 * pattern exists there because turning Auto-Apply on also runs a queue scan,
 * several round trips deep. This write is a single `profiles` UPDATE; a
 * disabled-while-pending switch is honest without needing an optimistic
 * value to paper over latency that barely exists.
 */
export function LeaderboardOptIn({
  optedIn,
  displayName,
}: {
  optedIn: boolean;
  displayName: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(optedIn);
  const [name, setName] = useState(displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save(nextEnabled: boolean, nextName: string) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setReferralLeaderboardPreferenceAction(nextEnabled, nextName);
      if (!result.ok) {
        setError(result.error ?? "That didn't save.");
        return;
      }
      setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-semibold text-ink">Referral leaderboard</h3>
          <p className="mt-1 max-w-[52ch] font-body text-[13px] text-ink-soft">
            Show up on this month&rsquo;s referral leaderboard, ranked by referrals that actually
            activated. Off by default — nobody sees this unless you turn it on.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Appear on the referral leaderboard"
          disabled={isPending}
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            save(next, name);
          }}
          className={[
            "relative inline-flex h-[26px] w-[46px] flex-shrink-0 items-center rounded-full border-[1.5px] border-ink transition-colors",
            enabled ? "bg-ink" : "bg-paper",
            isPending ? "opacity-50" : "",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-[16px] w-[16px] rounded-full transition-transform",
              enabled ? "translate-x-[25px] bg-paper" : "translate-x-[4px] bg-ink",
            ].join(" ")}
          />
        </button>
      </div>

      {enabled && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(enabled, name);
          }}
        >
          <div className="w-full max-w-[280px]">
            <TextField
              label="Display name (optional)"
              name="displayName"
              value={name}
              maxLength={60}
              placeholder={displayName ? undefined : "Defaults to your first name"}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save name"}
          </Button>
        </form>
      )}

      {saved && !isPending && (
        <p className="text-[12.5px] text-green">Saved.</p>
      )}
      {error && <p className="text-[12.5px] text-rust">{error}</p>}
    </div>
  );
}
