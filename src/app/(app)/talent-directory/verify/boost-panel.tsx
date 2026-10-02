"use client";

import { useState, useTransition } from "react";
import { requestTalentDirectoryBoostAction } from "@/lib/talent-directory/actions";
import { Button } from "@/components/ui";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { priced } from "@/lib/credits/price-labels";
import { TALENT_DIRECTORY_BOOST_DAYS } from "@/lib/talent-directory/boost-constants";
import { formatDate } from "@/lib/format/datetime";

/**
 * Talent Directory v2, part 1 (§6.13's third buyer segment): purchase entry
 * point for the seeker-paid search boost, plus the boost's own active/expired
 * state — so a purchase isn't invisible after the fact (scope item 4). Only
 * rendered once verified + opted-in (see verify/page.tsx), the same gate the
 * purchase itself re-checks server-side in runTalentDirectoryBoostPurchase.
 */
export function BoostPanel({ boostedUntil }: { boostedUntil: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const isActive = boostedUntil != null && new Date(boostedUntil) > new Date();

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-[48ch] text-[13.5px] text-ink-soft">
        Move to the top of employer search results for {TALENT_DIRECTORY_BOOST_DAYS} days —{" "}
        {CREDIT_COSTS.talentDirectoryBoost} credits. Purchases stack: buying again while already
        boosted adds {TALENT_DIRECTORY_BOOST_DAYS} more days on top of your current one.
      </p>

      {boostedUntil && (
        <p className={`text-[13px] ${isActive ? "text-green" : "text-ink-soft"}`}>
          {isActive
            ? `Boosted — active until ${formatDate(boostedUntil)}.`
            : `Your last boost expired ${formatDate(boostedUntil)}.`}
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await requestTalentDirectoryBoostAction();
              setMessage({ text: result.message, ok: result.status === "success" });
            })
          }
        >
          {priced(isActive ? "Extend boost" : "Boost my placement", CREDIT_COSTS.talentDirectoryBoost)}
        </Button>
      </div>
      {message && (
        <p className={`text-[13px] ${message.ok ? "text-green" : "text-rust"}`}>{message.text}</p>
      )}
    </div>
  );
}
