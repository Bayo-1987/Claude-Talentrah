"use client";

import { useActionState, useState } from "react";
import { claimJobPostingAction, type EmployerActionState } from "@/lib/employer/actions";
import { BorderedCard, Button } from "@/components/ui";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { ClaimCandidate } from "@/lib/employer/claim";

/**
 * One suggested match on the "Claim your company's listings" review screen
 * (0128, build-prompt §6.12).
 *
 * Collapsed by default: title, location, posted date, source and a
 * confidence badge — enough for a person to actually recognise their own
 * posting, per the task's own requirement, without every row defaulting to
 * an open edit form. Expanding reveals the review/edit fields
 * (claimJobPostingAction's own inputs) and the actual "Claim this listing"
 * submit — a real confirm step, never a one-click claim from the collapsed
 * row, which is the point of a review screen rather than a bulk-select list.
 */
export function ClaimCandidateCard({ candidate }: { candidate: ClaimCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState<EmployerActionState, FormData>(
    claimJobPostingAction,
    null,
  );
  const error = state && "error" in state ? state.error : null;

  return (
    <BorderedCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-display text-[18px] font-semibold text-ink">{candidate.title}</h3>
            <span
              className={
                candidate.confidence === "domain"
                  ? "border border-green px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-green uppercase"
                  : "border border-amber px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-amber uppercase"
              }
            >
              {candidate.confidence === "domain" ? "Matches your domain" : "Might be yours"}
            </span>
          </div>
          <p className="mt-1.5 font-body text-[13.5px] text-ink-soft">
            {candidate.companyName}
            {candidate.location ? ` · ${candidate.location}` : ""} · Posted{" "}
            {formatRelativeTime(candidate.postedAt)}
            {candidate.externalSource ? ` · via ${candidate.externalSource}` : ""}
          </p>
          {candidate.confidence === "name" && (
            <p className="mt-1.5 max-w-[56ch] font-body text-[12.5px] text-ink-soft">
              This one only matched on company name, which isn&apos;t unique — check the details below
              before claiming it.
            </p>
          )}
        </div>
        {!expanded && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setExpanded(true)}>
            Review &amp; claim
          </Button>
        )}
      </div>

      {expanded && (
        <form action={formAction} className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
          <input type="hidden" name="externalJobPostingId" value={candidate.id} />
          {error && (
            <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`title-${candidate.id}`} className="font-body text-[13px] font-semibold text-ink-soft">
              Job title
            </label>
            <input
              id={`title-${candidate.id}`}
              name="title"
              required
              defaultValue={candidate.title}
              className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`location-${candidate.id}`}
              className="font-body text-[13px] font-semibold text-ink-soft"
            >
              Location
            </label>
            <input
              id={`location-${candidate.id}`}
              name="location"
              defaultValue={candidate.location ?? ""}
              className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink outline-none focus:border-rust"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`description-${candidate.id}`}
              className="font-body text-[13px] font-semibold text-ink-soft"
            >
              Job description
            </label>
            <textarea
              id={`description-${candidate.id}`}
              name="description"
              required
              rows={10}
              placeholder="Paste or write the description for your own posting."
              className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] leading-[1.65] text-ink outline-none focus:border-rust"
            />
            <p className="font-body text-[12.5px] text-ink-soft">
              This becomes a brand new posting your organisation owns — the original listing wasn&apos;t
              copied automatically, since its text may not be yours to reuse as-is.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Claiming…" : "Claim this listing"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </BorderedCard>
  );
}
