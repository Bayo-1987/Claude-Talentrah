/**
 * Search results keep their apply controls (jobs-feed defect).
 *
 * The search RPC's rows carry no apply_email, apply_link_kind or apply_link_host. The card decides Apply by email and the employer career-site button from exactly those,
 * so on the search path an external posting that takes applications by email showed only "Mark as applied". withImportMarkers already reads job_postings once, by id, for
 * the import marker and the closing-date source; it now reads the three apply columns in the same read.
 *
 * Every test here builds the row the way the page does: an RPC-shaped row (no apply fields) -> withImportMarkers -> JobCard. Every address is invented.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
import { withImportMarkers } from "@/lib/jobs/import-markers";
import { JobCard } from "@/components/jobs/job-card";
import type { Tables } from "@/lib/supabase/types";

const ADDRESS = "careers@example.test";
const MAIL = "mailto:careers@example.test?subject=Application%3A%20Support%20Lead";

type Stored = { id: string; import_feed_id?: string | null; expires_at_source?: string | null; apply_email?: string | null; apply_link_kind?: string | null; apply_link_host?: string | null };

/** What search_job_postings returns for a posting: no import marker, no closing-date source, none of the apply fields. */
function rpcRow(over: Record<string, unknown> = {}) {
  return { id: "job-1", title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: null, status: "open", source_type: "external", posted_at: "2026-11-01T00:00:00.000Z", last_checked_at: null, ...over };
}

const client = (stored: Stored[]) => ({ from: () => ({ select: () => ({ in: async () => ({ data: stored, error: null }) }) }) });

function render(job: Record<string, unknown>, extra: Record<string, unknown> = {}) {
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
      applicantCount={null}
      {...extra}
    />,
  );
}

/** The searched card: the RPC row goes through withImportMarkers exactly as the page does it, then is rendered. */
async function searched(over: Record<string, unknown>, stored: Omit<Stored, "id">, extra: Record<string, unknown> = {}) {
  const [row] = await withImportMarkers(client([{ id: "job-1", ...stored }]), [rpcRow(over)]);
  return render(row, extra);
}

const anchors = (html: string) => [...html.matchAll(/<a [^>]*>[^<]*<\/a>/g)].map((m) => m[0]);
const named = (html: string, text: string) => anchors(html).filter((a) => a.includes(`>${text}</a>`));

describe("a searched external posting that takes applications by email only", () => {
  it("renders 'Apply by email' as a mailto link, with 'Mark as applied' beside it and no safeguard link", async () => {
    const html = await searched({}, { apply_email: ADDRESS });
    const found = named(html, "Apply by email");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`href="${MAIL}"`);
    expect(html).toContain("Mark as applied");
    expect(html).not.toContain("See how to apply");
    expect(html).not.toContain("Apply on company site");
  });

  it("is the same card the unsearched feed shows for the same posting (the feed row already carries the fields)", async () => {
    const searchedHtml = await searched({}, { apply_email: ADDRESS });
    const feedHtml = render(rpcRow({ import_feed_id: null, expires_at_source: null, apply_email: ADDRESS, apply_link_kind: null, apply_link_host: null }));
    expect(searchedHtml).toBe(feedHtml);
  });

  it("never prints the address as text, and only the mailto href carries it", async () => {
    const html = await searched({}, { apply_email: ADDRESS });
    const withoutHref = html.replace(/href="mailto:[^"]*"/g, 'href=""');
    expect(withoutHref).not.toContain(ADDRESS);
    expect(withoutHref).not.toContain("example.test");
    expect(withoutHref.toLowerCase()).not.toContain("careers@");
  });

  it("a sponsored searched card tracks the mailto anchor like the company-site anchor", async () => {
    const html = await searched({}, { apply_email: ADDRESS }, { isSponsored: true, campaignId: "c-1" });
    expect(named(html, "Apply by email")[0]).toContain('data-ad-click="true"');
  });
});

describe("a searched external posting with a company link", () => {
  it("still shows 'Apply on company site' and no safeguard", async () => {
    const html = await searched({ external_url: "https://careers.acme.test/1" }, {});
    expect(named(html, "Apply on company site")).toHaveLength(1);
    expect(html).not.toContain("See how to apply");
    expect(html).not.toContain("mailto:");
  });

  it("with an address as well, the link stays primary and the address is the secondary choice", async () => {
    const html = await searched({ external_url: "https://careers.acme.test/1" }, { apply_email: ADDRESS });
    expect(named(html, "Apply on company site")).toHaveLength(1);
    expect(named(html, "Or apply by email")).toHaveLength(1);
    expect(html).not.toContain("See how to apply");
  });
});

describe("a searched external posting with neither a link nor an address (the safeguard)", () => {
  it("shows 'See how to apply' linking to the job page, keeps 'Mark as applied', and has no mailto, no '#' and no company-site anchor", async () => {
    const html = await searched({}, {});
    const found = named(html, "See how to apply");
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('href="/jobs/job-1"');
    expect(html).toContain("Mark as applied");
    expect(html).not.toMatch(/mailto:|Apply by email|Apply on company site/);
    expect(html).not.toContain('href="#"');
  });

  it("is not an ad click: the safeguard link carries no data-ad-click even on a sponsored card", async () => {
    const html = await searched({}, {}, { isSponsored: true, campaignId: "c-1" });
    expect(named(html, "See how to apply")[0]).not.toContain("data-ad-click");
  });

  it("an address that fails validation counts as no address, so the safeguard shows and the raw text does not", async () => {
    const html = await searched({}, { apply_email: "a@b.co?cc=x" });
    expect(named(html, "See how to apply")).toHaveLength(1);
    expect(html).not.toContain("a@b.co");
  });

  it("the read returning nothing for the row (or failing) leaves the safeguard, not a lone 'Mark as applied'", async () => {
    const [row] = await withImportMarkers(client([]), [rpcRow()]);
    const html = render(row);
    expect(named(html, "See how to apply")).toHaveLength(1);
    expect(html).toContain("Mark as applied");
  });
});

describe("internal postings", () => {
  it("an internal posting with no address and no link is the ordinary in-app Apply, with no safeguard", async () => {
    const html = await searched({ source_type: "internal" }, {});
    expect(html).toMatch(/type="submit">Apply<\/button>/);
    expect(html).not.toMatch(/See how to apply|Mark as applied|mailto:/);
  });

  it("an internal employer posting that takes applications by email shows 'Apply by email' from search, as it does in the feed", async () => {
    const html = await searched({ source_type: "internal" }, { apply_email: ADDRESS });
    expect(named(html, "Apply by email")).toHaveLength(1);
    expect(html).not.toMatch(/type="submit">Apply<\/button>|See how to apply/);
  });

  it("an internal employer posting that takes applications on its career site shows that button from search, as it does in the feed", async () => {
    const stored = { apply_link_kind: "company", apply_link_host: "careers.acme.test" };
    const searchedHtml = await searched({ source_type: "internal" }, stored);
    const feedHtml = render(rpcRow({ source_type: "internal", import_feed_id: null, expires_at_source: null, apply_email: null, ...stored }));
    expect(searchedHtml).toBe(feedHtml);
    expect(searchedHtml).not.toMatch(/type="submit">Apply<\/button>|See how to apply/);
  });
});

describe("withImportMarkers reads the apply columns in its one read", () => {
  it("selects all five columns in ONE query", async () => {
    const selects: string[] = [];
    let calls = 0;
    const spy = { from: () => { calls += 1; return { select: (cols: string) => { selects.push(cols); return { in: async () => ({ data: [], error: null }) }; } }; } };
    await withImportMarkers(spy, [{ id: "a" }]);
    expect(calls).toBe(1);
    expect(selects).toEqual(["id, import_feed_id, expires_at_source, apply_email, apply_link_kind, apply_link_host"]);
  });

  it("puts each row's own values on that row and nulls on a row the read did not return", async () => {
    const out = await withImportMarkers(
      client([
        { id: "a", apply_email: "a@example.test", apply_link_kind: null, apply_link_host: null },
        { id: "b", apply_email: null, apply_link_kind: "ats", apply_link_host: "boards.example.test" },
      ]),
      [{ id: "a" }, { id: "b" }, { id: "c" }],
    );
    expect(out.map((r) => [r.id, r.apply_email, r.apply_link_kind, r.apply_link_host])).toEqual([
      ["a", "a@example.test", null, null],
      ["b", null, "ats", "boards.example.test"],
      ["c", null, null, null],
    ]);
  });

  it("a failed read logs and gives every row nulls for the three fields", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) };
    const out = await withImportMarkers(failing, [{ id: "a" }]);
    // toStrictEqual: toEqual would let `undefined` stand in for the null.
    expect(out).toStrictEqual([{ id: "a", import_feed_id: null, expires_at_source: null, apply_email: null, apply_link_kind: null, apply_link_host: null }]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("the feed page still calls it in one place with the search result's rows", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/(feed)/page.tsx"), "utf8");
    expect(src.split("withImportMarkers(supabase, result.data)")).toHaveLength(2);
  });
});
