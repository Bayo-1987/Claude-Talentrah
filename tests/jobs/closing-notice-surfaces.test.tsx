/**
 * P5 (JOBS-POLISH-1): where the closing date shows. The feed card (static render of the real JobCard), the job page (its source, which cannot be rendered here) and the structured data.
 * Shown ONLY where expires_at_source is 'stated'; a 'default' or unknown (NULL) row shows no date and emits no validThrough.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JobCard } from "@/components/jobs/job-card";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";
import type { Tables } from "@/lib/supabase/types";

const NOW = new Date("2026-11-10T08:00:00Z");
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const DAY = 86_400_000;
function card(over: Record<string, unknown>) {
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
          posted_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
          last_checked_at: NOW.toISOString(),
          expires_at: null,
          ...over,
        } as unknown as Tables<"job_postings">
      }
      score={75}
      isSaved={false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
    />,
  );
}

describe("the feed card", () => {
  it("POSITIVE CONTROL: a stated date shows 'Closes <date>', and 'Closing soon' when it is 7 days or fewer away", () => {
    const html = card({ expires_at: "2026-11-24T12:00:00Z", expires_at_source: "stated" });
    expect(html).toContain("Closes 24 Nov 2026");
    expect(html).not.toContain("Closing soon");
    const soon = card({ expires_at: "2026-11-17T12:00:00Z", expires_at_source: "stated" });
    expect(soon).toContain("Closes 17 Nov 2026");
    expect(soon).toContain("Closing soon");
  });
  it("one day past the threshold has the date and no tag", () => {
    const html = card({ expires_at: "2026-11-18T12:00:00Z", expires_at_source: "stated" });
    expect(html).toContain("Closes 18 Nov 2026");
    expect(html).not.toContain("Closing soon");
  });
  for (const source of ["default", null, undefined]) {
    it(`a ${source === undefined ? "missing" : String(source)} source shows no date and no tag, even 3 days out`, () => {
      const html = card({ expires_at: "2026-11-13T12:00:00Z", expires_at_source: source });
      expect(html).not.toContain("Closes");
      expect(html).not.toContain("Closing soon");
    });
  }
  it("a stated date that has passed shows nothing", () => {
    const html = card({ expires_at: "2026-11-05T12:00:00Z", expires_at_source: "stated" });
    expect(html).not.toContain("Closes");
  });
  it("leaves the age line exactly as it was: the 'Posted ... ago' text is still one span", () => {
    expect(card({ expires_at: "2026-11-17T12:00:00Z", expires_at_source: "stated" })).toMatch(/<span class="[^"]*">Posted 2 days ago/);
  });
});

describe("the job page", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8");
  it("shows the same notice, from the same component, with the posting's own row", () => {
    expect(src).toContain('import { ClosingNotice } from "@/components/jobs/closing-notice";');
    expect(src.replace(/\s+/g, " ")).toContain("<ClosingNotice job={job} />");
  });
});

describe("structured data: validThrough only for a stated date", () => {
  const base = {
    id: "job-1",
    title: "Associate Product Manager",
    company_name: "Reliance Health",
    description: "A real posting with enough words in it to stand as a description of the role itself.",
    location: "Lagos, Nigeria",
    work_type: "onsite",
    status: "open",
    source_type: "external",
    posted_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    employment_type: "full_time",
    expires_at: "2026-11-24T12:00:00Z",
  } as unknown as Tables<"job_postings">;
  it("POSITIVE CONTROL: a stated date is emitted", () => {
    const ld = buildJobPostingJsonLd({ ...base, expires_at_source: "stated" } as never);
    expect(ld).not.toBeNull();
    expect(ld!.validThrough).toBe("2026-11-24T12:00:00.000Z");
  });
  for (const source of ["default", null, undefined]) {
    it(`a ${source === undefined ? "missing" : String(source)} source emits the posting without validThrough`, () => {
      const ld = buildJobPostingJsonLd({ ...base, expires_at_source: source } as never);
      expect(ld, "the posting itself is still described").not.toBeNull();
      expect("validThrough" in ld!).toBe(false);
    });
  }
});
