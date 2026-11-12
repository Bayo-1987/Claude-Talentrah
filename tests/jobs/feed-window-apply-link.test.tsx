/**
 * PR-E4 x FEED-PERF-1: a page-2 card is built from Read B (the full card columns for the page's ids), not from Read A's narrow rows. So the link kind and host must be in Read B's column list, or a
 * career-site job on page 2 silently loses its "Apply on company site" control. The page cannot be rendered here, so the test reads the page's own FEED_COLUMNS literal, projects a database row
 * onto exactly those columns (what PostgREST would return), puts it back in ranked order with the real attachFullRows, and renders the real JobCard. The stored address is in the database row and
 * must never reach the card, because FEED_COLUMNS never selects it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { attachFullRows } from "@/lib/jobs/feed-window";
import type { Tables } from "@/lib/supabase/types";

const page = readFileSync(path.resolve(__dirname, "../..", "src/app/(app)/jobs/(feed)/page.tsx"), "utf8");
const FEED_COLUMNS = /const FEED_COLUMNS =\s*"([^"]+)"/.exec(page)?.[1] ?? "";
const JOB = "22222222-2222-4222-8222-222222222222";
const STORED = "https://careers.acme.test/secret-path/apply?id=77";

/** What a PostgREST select of `columns` returns for `row`: only the named columns, an alias (`out:column`) renamed. */
function project(columns: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const token of columns.split(",").map((t) => t.trim()).filter(Boolean)) {
    const [alias, source] = token.includes(":") ? token.split(":").map((t) => t.trim()) : [token, token];
    if (source in row) out[alias] = row[source];
  }
  return out;
}

const dbRow = {
  id: JOB, source_type: "internal", organization_id: "org-1", title: "Support Lead", company_name: "Acme", company_logo_url: null, location: "Lagos", work_type: null, employment_type: null, seniority: null,
  years_experience_min: null, description_preview: "A real posting.", structured_jd: null, external_url: null, external_source: null, status: "open", posted_at: "2026-11-01T00:00:00.000Z",
  last_checked_at: null, dedup_fingerprint: null, created_at: "2026-11-01T00:00:00.000Z", expires_at: null, removed_at: null, removal_reason: null, removed_by: null, salary_min: null, salary_max: null,
  salary_currency: null, salary_unit: null, import_feed_id: null, apply_email: null,
  apply_link: STORED, apply_link_kind: "company", apply_link_host: "careers.acme.test",
};

/** Page 2 of the ranked window: Read A gave a narrow row (no apply columns), Read B gives the card row. */
function pageTwoCard() {
  const narrow = { id: JOB, source_type: "internal", organization_id: "org-1" };
  const pageRanked = [{ job: narrow, score: 75, explanation: { matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" } }];
  const readB = [project(FEED_COLUMNS, dbRow)] as Array<typeof narrow>;
  const [card] = attachFullRows(pageRanked as never, readB as never) as unknown as Array<{ job: Record<string, unknown>; score: number }>;
  return renderToStaticMarkup(
    <JobCard
      job={card.job as unknown as Tables<"job_postings">}
      score={card.score}
      isSaved={false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={null}
    />,
  );
}

describe("a page-2 card for a career-site job (FEED-PERF-1 Read B)", () => {
  it("FEED_COLUMNS was found, and names the link kind and host but never the address", () => {
    expect(FEED_COLUMNS.length).toBeGreaterThan(50);
    expect(FEED_COLUMNS).toMatch(/\bapply_link_kind\b/);
    expect(FEED_COLUMNS).toMatch(/\bapply_link_host\b/);
    expect(FEED_COLUMNS).not.toMatch(/\bapply_link\b(?![_a-z])/);
  });
  it("Read B selects FEED_COLUMNS for the page's ids", () => {
    expect(page.replace(/\s+/g, " ")).toContain('.select(FEED_COLUMNS).in("id", readBIds)');
  });
  it("renders the /jobs/{id}/go control with the host in its aria-label only (no visible caption), and the stored address is nowhere in the card", () => {
    const html = pageTwoCard();
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(html).toContain(`href="/jobs/${JOB}/go"`);
    expect(html).toContain("Apply on company site");
    expect(html).toContain('aria-label="Apply on company site, opens careers.acme.test in a new tab"');
    expect(text).not.toMatch(/\bOpens\b/i);
    expect(text).not.toContain("careers.acme.test");
    expect(html).not.toContain(STORED);
    expect(html).not.toContain("secret-path");
    expect(html).not.toMatch(/<button[^>]*>\s*Apply\s*<\/button>/);
  });
  it("control: with the link columns missing from Read B the card loses the control (so the test can fail)", () => {
    const without = FEED_COLUMNS.replace(", apply_link_kind", "").replace(", apply_link_host", "");
    const row = project(without, dbRow);
    expect(row.apply_link_kind).toBeUndefined();
    expect(row.apply_link_host).toBeUndefined();
  });
});
