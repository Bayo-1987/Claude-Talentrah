"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { runEligibilityCheckAction, draftSopAction } from "@/lib/scholarships/actions";
import type { EligibilityCheckResult } from "@/lib/scholarships/farah";
import { cn } from "@/lib/cn";

const VERDICT_LABEL: Record<EligibilityCheckResult["verdict"], string> = {
  likely_eligible: "Likely eligible",
  partly_eligible: "Partly eligible",
  likely_ineligible: "Likely not eligible",
};

// Reuses the three-tier match colour language rather than inventing a
// fourth: green = clear, rust = mixed, amber = weakest. No new tier names.
const VERDICT_CLASS: Record<EligibilityCheckResult["verdict"], string> = {
  likely_eligible: "text-green",
  partly_eligible: "text-rust",
  likely_ineligible: "text-amber",
};

const STATUS_CLASS: Record<string, string> = {
  meets: "text-green",
  gap: "text-amber",
  unclear: "text-ink-soft",
};

export function FarahActions({
  scholarshipId,
  creditsBalance,
  passCovered,
}: {
  scholarshipId: string;
  creditsBalance: number;
  /**
   * checkPassCoverage(userId).covered, computed server-side by the page —
   * NOT re-derived here. A covered user must never see a credit price for
   * an action their Pass already covers; showing one reads as a purchase
   * that did nothing.
   */
  passCovered: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<"none" | "eligibility" | "sop">("none");
  const [eligibility, setEligibility] = useState<EligibilityCheckResult | null>(null);
  const [statement, setStatement] = useState<string | null>(null);
  const [motivation, setMotivation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const eligibilityCost = CREDIT_COSTS.scholarshipEligibilityCheck;
  const sopCost = CREDIT_COSTS.scholarshipSopDraft;

  function runEligibility() {
    setError(null);
    startTransition(async () => {
      const res = await runEligibilityCheckAction(scholarshipId);
      if (res.error) setError(res.error);
      else {
        setEligibility(res.result ?? null);
        setOpen("eligibility");
      }
    });
  }

  function runSop() {
    setError(null);
    startTransition(async () => {
      const res = await draftSopAction(scholarshipId, motivation);
      if (res.error) setError(res.error);
      else setStatement(res.statement ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={runEligibility}
        >
          {pending && open !== "sop"
            ? "Farah is checking…"
            : passCovered
              ? "Check my eligibility · Included with your Pass"
              : `Check my eligibility · ${eligibilityCost} credits`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setOpen(open === "sop" ? "none" : "sop")}
        >
          {passCovered
            ? "Draft my personal statement · Included with your Pass"
            : `Draft my personal statement · ${sopCost} credits`}
        </Button>
        <span className="text-[12.5px] text-ink-soft">
          {passCovered ? "Included with your Pass" : `You have ${creditsBalance} credits`}
        </span>
      </div>

      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3 py-2 text-[13px] text-rust">
          {error}{" "}
          {error.startsWith("Not enough credits") && (
            <Link href="/billing" className="underline underline-offset-2">
              Top up
            </Link>
          )}
        </p>
      )}

      {open === "sop" && (
        <div className="flex flex-col gap-2">
          <label htmlFor={`motivation-${scholarshipId}`} className="text-[13px] font-semibold text-ink-soft">
            Why are you applying? (optional — Farah works from your resume otherwise)
          </label>
          <textarea
            id={`motivation-${scholarshipId}`}
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            rows={3}
            className="w-full border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[13.5px] text-ink outline-none focus:border-rust"
            placeholder="A sentence or two in your own words."
          />
          <Button type="button" size="sm" disabled={pending} onClick={runSop} className="w-fit">
            {pending
              ? "Farah is drafting…"
              : passCovered
                ? "Draft it · Included with your Pass"
                : `Draft it · ${sopCost} credits`}
          </Button>
        </div>
      )}

      {eligibility && open === "eligibility" && (
        <div className="flex flex-col gap-2 border-[1.5px] border-line p-4">
          <span className={cn("font-body text-[13px] font-bold uppercase tracking-[0.1em]", VERDICT_CLASS[eligibility.verdict])}>
            {VERDICT_LABEL[eligibility.verdict]}
          </span>
          <p className="text-[13.5px] text-ink-soft">{eligibility.summary}</p>
          <ul className="flex flex-col gap-1.5">
            {eligibility.criteria.map((c, i) => (
              <li key={i} className="text-[13px]">
                <span className={cn("font-semibold", STATUS_CLASS[c.status] ?? "text-ink-soft")}>
                  {c.status === "meets" ? "Meets" : c.status === "gap" ? "Gap" : "Unclear"}
                </span>{" "}
                — <span className="font-semibold text-ink">{c.criterion}</span>{" "}
                <span className="text-ink-soft">{c.note}</span>
              </li>
            ))}
          </ul>
          {eligibility.suggestedNextSteps.length > 0 && (
            <>
              <span className="text-[12.5px] font-semibold text-ink-soft">Next steps</span>
              <ul className="list-disc pl-5 text-[13px] text-ink-soft">
                {eligibility.suggestedNextSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          <p className="text-[12px] italic text-ink-soft">
            Farah reads the criteria as listed here — the official page is always the authority.
          </p>
        </div>
      )}

      {statement && (
        <div className="flex flex-col gap-2 border-[1.5px] border-line p-4">
          <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Your draft statement
          </span>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{statement}</p>
          <p className="text-[12px] italic text-ink-soft">
            A first draft in your voice — edit it before you submit.
          </p>
        </div>
      )}
    </div>
  );
}
