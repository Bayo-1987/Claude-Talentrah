/**
 * Option B (owner, S3-52): a job card shows one plain line, not a breakdown block, and the full breakdown moves to the job detail page. A2's
 * "Role fit" cell therefore must NOT appear on the card, even when the stored score carries a roleFit; it shows on the job detail page only
 * (tests/jobs/match-breakdown.test.tsx pins the opt-in, this pins the card and the page's call site). Adding role fit to the card's one line is
 * the Option B PR's job, not A2's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import type { Tables } from "@/lib/supabase/types";
import type { MatchExplanation } from "@/lib/matching/score";

function card(explanation: MatchExplanation) {
  return renderToStaticMarkup(
    <JobCard
      job={
        {
          id: "job-1",
          title: "Associate Product Manager",
          company_name: "Reliance Health",
          description: "A real posting.",
          location: "Lagos",
          work_type: null,
          seniority: null,
          external_url: "https://example.test/apply",
          status: "open",
          source_type: "external",
          posted_at: new Date().toISOString(),
          last_checked_at: new Date().toISOString(),
        } as unknown as Tables<"job_postings">
      }
      score={75}
      isSaved={false}
      applicationStage={null}
      explanation={explanation}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={null}
    />,
  );
}

describe("A2's Role fit cell is not on the job card", () => {
  it("a card whose score carries roleFit 'different' / 'adjacent' / 'same' renders no 'Role fit' cell and none of its three words as a cell value", () => {
    for (const roleFit of ["different", "adjacent", "same"] as const) {
      const html = card({ matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "match", roleFit });
      expect(html, `roleFit ${roleFit}`).not.toContain("Role fit");
      expect(html).not.toContain(">Same family<");
    }
  });
});

describe("the job detail page is the one caller that turns it on", () => {
  const page = readFileSync("src/app/(app)/jobs/[id]/page.tsx", "utf8");

  it("passes showRoleFit to its MatchBreakdown", () => {
    expect(page).toMatch(/<MatchBreakdown[^>]*\bshowRoleFit\b/);
  });

  it("the card and the employer applicant list do not", () => {
    for (const f of ["src/components/jobs/job-card.tsx", "src/components/employer/applicant-list.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("<MatchBreakdown");
      expect(src, `${f} must not show Role fit`).not.toMatch(/<MatchBreakdown[^>]*showRoleFit/);
    }
  });
});
