import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "@/lib/scholarships/types";
import { daysUntil, formatDeadline } from "./scholarship-card";
import type { Tables } from "@/lib/supabase/types";

/**
 * A scholarship on an SEO landing page — read-only, no Save/Farah widgets.
 *
 * Not ScholarshipCard: that component embeds SaveToggle and FarahActions
 * unconditionally, both of which need a signed-in user to do anything —
 * rendering them for a signed-out visitor would be either broken or
 * misleading. Links to the detail page (not straight to the official URL)
 * so the landing page contributes internal link equity to /scholarships/[id]
 * and so the signed-out visitor lands on the page with the actual signup
 * CTA, matching how PublicJobRow routes through /jobs/[id] for the same
 * reason.
 */
export function PublicScholarshipRow({ scholarship }: { scholarship: Tables<"scholarships"> }) {
  const left = daysUntil(scholarship.application_deadline);
  const urgent = left !== null && left >= 0 && left <= 14;

  return (
    <BorderedCard className="flex flex-col gap-2.5 p-5">
      <div>
        <span className="font-body text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {scholarship.provider}
        </span>
        <h3 className="text-[17px]">
          <Link
            href={`/scholarships/${scholarship.id}`}
            className="text-ink no-underline hover:text-rust hover:underline"
          >
            {scholarship.program_name}
          </Link>
        </h3>
        {scholarship.host_institution && (
          <span className="text-[13px] text-ink-soft">{scholarship.host_institution}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {scholarship.degree_levels.map((level) => (
          <span
            key={level}
            className="inline-flex min-h-6 items-center border border-line px-2 text-[11.5px] font-semibold text-ink-soft"
          >
            {DEGREE_LEVEL_LABEL[level]}
          </span>
        ))}
        <span className="inline-flex min-h-6 items-center border border-line px-2 text-[11.5px] font-semibold text-ink-soft">
          {FUNDING_TYPE_LABEL[scholarship.funding_type]}
        </span>
      </div>

      <span className="text-[13px] text-ink-soft">
        <span className="font-semibold">Deadline:</span>{" "}
        <span className={urgent ? "font-semibold text-rust" : undefined}>
          {scholarship.application_deadline
            ? formatDeadline(scholarship.application_deadline)
            : (scholarship.deadline_note ?? "Not published yet")}
        </span>
      </span>
    </BorderedCard>
  );
}
