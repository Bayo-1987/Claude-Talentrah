import { formatDeadline } from "@/components/scholarships/scholarship-card";
import { publicDeadlineNote } from "@/lib/scholarships/public-deadline-note";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "@/lib/scholarships/types";
import type { Tables } from "@/lib/supabase/types";

type MetaFields = Pick<
  Tables<"scholarships">,
  "funding_type" | "host_institution" | "degree_levels" | "application_deadline" | "deadline_note" | "deadline_verified_at"
>;

/**
 * The scholarship detail page's SEO description, built from the listing's own fields, not truncated prose: scholarships carry no free-text description
 * column the way a job posting does. Deadline text mirrors the page's own display rule: the stored date, or the deadline note verbatim (only when it
 * is a verified finding: publicDeadlineNote), never a reconstruction. A search result is as public as the page, so an unverified note stays out of it too.
 */
export function scholarshipMetaDescription(data: MetaFields): string {
  const levels = data.degree_levels?.length ? data.degree_levels.map((l) => DEGREE_LEVEL_LABEL[l]).join("/") : null;
  const lead = [
    `${FUNDING_TYPE_LABEL[data.funding_type]} scholarship`,
    data.host_institution ? `at ${data.host_institution}` : null,
    levels ? `for ${levels} study` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const deadlineText = data.application_deadline ? `Apply by ${formatDeadline(data.application_deadline)}` : publicDeadlineNote(data);
  return ([lead, deadlineText].filter(Boolean).join(". ").slice(0, 155)) || lead;
}
