/**
 * JOBS-POLISH-1 part A: a closing date on a SEARCH result card. The search RPC (search_job_postings) returns expires_at but not expires_at_source, so before this a search card never showed "Closes <date>"
 * (the safe reading: no source, no claim). The feed page now passes the RPC's rows through withImportMarkers, which adds the source; a promoted job that appears in a search is one of those rows.
 * Static render of the real JobCard, as tests/jobs/closing-notice-surfaces.test.tsx does it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JobCard } from "@/components/jobs/job-card";
import { withImportMarkers } from "@/lib/jobs/import-markers";
import type { Tables } from "@/lib/supabase/types";

const NOW = new Date("2026-11-10T08:00:00Z");
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => vi.useRealTimers());

const DAY = 86_400_000;
/** What search_job_postings returns for a posting: expires_at, and no expires_at_source. */
const rpcRow = (id: string, expires_at: string | null) => ({
  id,
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
  expires_at,
});
const client = (rows: Array<{ id: string; import_feed_id: string | null; expires_at_source: string | null }>) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) });
const failing = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) };

function card(job: Record<string, unknown>) {
  return renderToStaticMarkup(
    <JobCard
      job={job as unknown as Tables<"job_postings">}
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
const enriched = async (source: string | null, expires_at: string | null) => {
  const [row] = await withImportMarkers(client([{ id: "j1", import_feed_id: null, expires_at_source: source }]), [rpcRow("j1", expires_at)]);
  return row;
};

describe("a search result card", () => {
  it("POSITIVE CONTROL: a stated date shows 'Closes <date>' once the row has been through withImportMarkers, with 'Closing soon' inside 7 days", async () => {
    expect(card(await enriched("stated", "2026-11-24T12:00:00Z"))).toContain("Closes 24 Nov 2026");
    const soon = card(await enriched("stated", "2026-11-14T12:00:00Z"));
    expect(soon).toContain("Closes 14 Nov 2026");
    expect(soon).toContain("Closing soon");
  });
  it("a default or unknown (null) source shows nothing, even 3 days out", async () => {
    for (const source of ["default", null]) {
      const html = card(await enriched(source, "2026-11-13T12:00:00Z"));
      expect(html).not.toContain("Closes");
      expect(html).not.toContain("Closing soon");
    }
  });
  it("a failed read shows nothing (it is logged, never a claim)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const [row] = await withImportMarkers(failing, [rpcRow("j1", "2026-11-24T12:00:00Z")]);
    expect(card(row)).not.toContain("Closes");
    log.mockRestore();
  });
  it("without the enrichment the raw RPC row shows nothing (which is why the page runs it)", () => {
    expect(card(rpcRow("j1", "2026-11-24T12:00:00Z"))).not.toContain("Closes");
  });
  it("only the row whose source is stated shows a date, when stated and default rows are searched together", async () => {
    const rows = await withImportMarkers(
      client([{ id: "s", import_feed_id: null, expires_at_source: "stated" }, { id: "d", import_feed_id: null, expires_at_source: "default" }]),
      [rpcRow("s", "2026-11-24T12:00:00Z"), rpcRow("d", "2026-11-24T12:00:00Z")],
    );
    expect(rows.map((r) => card(r).includes("Closes 24 Nov 2026"))).toEqual([true, false]);
  });
});

describe("the feed page", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/(feed)/page.tsx"), "utf8").replace(/\s+/g, " ");
  it("passes the search RPC's rows through withImportMarkers, and that is where a searched promoted card gets its source", () => {
    expect(src).toContain('const result = await supabase.rpc("search_job_postings"');
    expect(src).toContain("return { ...result, data: await withImportMarkers(supabase, result.data) };");
  });
});
