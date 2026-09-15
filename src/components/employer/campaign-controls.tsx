"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { EmployerActionState } from "@/lib/employer/actions";

export type CampaignStatus =
  | "draft"
  | "pending_review"
  | "rejected"
  | "active"
  | "paused_by_employer"
  | "paused_insufficient_funds"
  | "completed";

/**
 * Status presentation.
 *
 * Deliberately NOT reusing the match-tier colours. Green/rust/amber are the
 * three match tiers and CLAUDE.md is explicit that they mean one thing
 * everywhere — a campaign that is "amber" would read as a Fair match. Only
 * `active` takes green, because "this is running and spending" is the one
 * state where a colour earns its place; everything else is ink, differentiated
 * by words.
 */
const STATUS: Record<CampaignStatus, { label: string; className: string; blurb: string }> = {
  draft: {
    label: "Draft",
    className: "border-line text-ink-soft",
    blurb: "Not submitted yet. Nothing has been charged.",
  },
  pending_review: {
    label: "In review",
    className: "border-ink text-ink",
    blurb:
      "With our team. Review is about the ad's content — approval doesn't start the campaign or charge you.",
  },
  rejected: {
    label: "Changes needed",
    className: "border-rust text-rust",
    blurb: "Not approved. Edit it and submit again — nothing was charged.",
  },
  active: {
    label: "Running",
    className: "border-green text-green",
    blurb: "Live and charged once per day it runs.",
  },
  paused_by_employer: {
    label: "Paused",
    className: "border-ink text-ink",
    blurb: "Not running and not being charged. Resuming charges for that day.",
  },
  paused_insufficient_funds: {
    label: "Out of funds",
    className: "border-rust text-rust",
    blurb:
      "Stopped because your ad wallet couldn't cover a day. Top up, then resume — nothing was charged for the day it couldn't pay for.",
  },
  completed: {
    label: "Finished",
    className: "border-line text-ink-soft",
    blurb: "Budget spent or end date passed. Create a new campaign to run it again.",
  },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-block border-[1.5px] px-2.5 py-1 font-body text-[11px] font-bold tracking-[0.14em] uppercase ${s.className}`}
    >
      {s.label}
    </span>
  );
}

export function CampaignStatusBlurb({ status }: { status: CampaignStatus }) {
  return <p className="font-body text-[13.5px] text-ink-soft">{STATUS[status].blurb}</p>;
}

export function CampaignControls({
  status,
  submitForReview,
  pause,
  resume,
}: {
  status: CampaignStatus;
  submitForReview: () => Promise<EmployerActionState>;
  pause: () => Promise<EmployerActionState>;
  resume: () => Promise<EmployerActionState>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<EmployerActionState>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result && "error" in result) setError(result.error);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {(status === "draft" || status === "rejected") && (
          <Button onClick={() => run(submitForReview)} disabled={pending}>
            {pending ? "Submitting…" : "Submit for review"}
          </Button>
        )}
        {status === "active" && (
          <Button variant="secondary" onClick={() => run(pause)} disabled={pending}>
            {pending ? "Pausing…" : "Pause campaign"}
          </Button>
        )}
        {(status === "paused_by_employer" || status === "paused_insufficient_funds") && (
          <Button onClick={() => run(resume)} disabled={pending}>
            {/*
              Labelled with the consequence, not the verb. "Resume" hides that
              this debits the wallet for today the moment it succeeds, and a
              button that spends money should say so before it is clicked.
            */}
            {pending ? "Starting…" : "Resume — charges for today"}
          </Button>
        )}
      </div>
    </div>
  );
}
