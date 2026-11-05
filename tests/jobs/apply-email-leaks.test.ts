/**
 * The address a posting can be applied to by email is public on exactly two surfaces: the signed-in job page's Apply area and the signed-in feed card (PR-E1).
 * It must not reach structured data, the page's meta tags, the share image, the sitemap, the embed widget, a digest or an e-mail.
 *
 *   - structured data: the JSON-LD built for a job that has the column set contains neither the address nor `mailto`;
 *   - source scan: the files that NAME the column are exactly the allowlist below. Any other file that starts to read it fails here until the list is changed on purpose.
 *     The share image and the page's metadata read the same row, so they are also checked by name.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";

const ROOT = process.cwd();
const ADDRESS = "careers@example.test";

describe("structured data", () => {
  const job = (over: Record<string, unknown>) => ({
    id: "job-1", organization_id: "org-1", title: "Support Lead", company_name: "Acme", description: "<p>Do support work for customers across Nigeria.</p>", location: "Lagos, Nigeria", work_type: "onsite", employment_type: "full_time", status: "open",
    source_type: "external", external_url: null, apply_email: ADDRESS, posted_at: new Date().toISOString(), expires_at: null, import_feed_id: null, organizations: { name: "Acme", website: null, logo_url: null }, ...over,
  });
  it.each([
    ["address only", job({})],
    ["address and company link", job({ external_url: "https://careers.acme.test/1" })],
    ["an imported posting with an address", job({ source_type: "internal", import_feed_id: "11111111-1111-4111-8111-111111111111" })],
    ["an internal posting with an address", job({ source_type: "internal" })],
  ])("the JSON-LD for %s names neither the address nor mailto", (_name, row) => {
    const ld = buildJobPostingJsonLd(row as never);
    expect(ld, "the fixture must produce structured data, or this test proves nothing").not.toBeNull();
    const text = JSON.stringify(ld);
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain("example.test");
    expect(text.toLowerCase()).not.toContain("mailto");
    expect(text).not.toContain("apply_email");
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|sql|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("where the column is named (source scan)", () => {
  const ALLOWED = [
    "src/app/(app)/jobs/(feed)/page.tsx", // FEED_COLUMNS
    "src/app/(app)/jobs/[id]/page.tsx", // the Apply area
    "src/components/jobs/job-card.tsx", // the card's prop type and Apply area
    "src/lib/account-export/manifest.ts", // names only the audit table job_posting_apply_email_events (excluded from the export)
    "src/lib/jobs/apply-email.ts", // the helper (named in its header)
    "src/lib/jobs/job-columns.ts", // JOB_DETAIL_COLUMNS
    "src/lib/supabase/types.ts", // generated types
  ];
  const named = sourceFiles(path.join(ROOT, "src"))
    .filter((f) => readFileSync(f, "utf8").includes("apply_email"))
    .map((f) => path.relative(ROOT, f))
    .sort();

  it("only the allowlisted files under src/ name apply_email", () => {
    expect(named).toEqual([...ALLOWED].sort());
  });

  it("the export manifest names apply_email only inside the audit table's name", () => {
    const manifest = readFileSync(path.join(ROOT, "src/lib/account-export/manifest.ts"), "utf8");
    expect(manifest).toContain("job_posting_apply_email_events");
    expect(manifest.split("job_posting_apply_email_events").join("")).not.toContain("apply_email");
  });

  it("the page's metadata function and the share image never name the address", () => {
    const page = readFileSync(path.join(ROOT, "src/app/(app)/jobs/[id]/page.tsx"), "utf8");
    const meta = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default async function JobDetailPage"));
    expect(meta.length).toBeGreaterThan(500);
    expect(meta).not.toMatch(/apply_email|applyEmail|mailto/);
    for (const f of ["src/app/(app)/jobs/[id]/opengraph-image.tsx", "src/app/(app)/jobs/[id]/job-for-request.ts", "src/app/sitemap.ts", "src/lib/embed/widget-html.ts", "src/lib/seo/job-posting-jsonld.ts"]) {
      expect(readFileSync(path.join(ROOT, f), "utf8"), f).not.toMatch(/apply_email|applyEmail|mailto/);
    }
  });

  it("no e-mail or digest template names it or builds a mailto link to a posting's address", () => {
    const templates = sourceFiles(path.join(ROOT, "src")).filter((f) => /(template|digest|email)/i.test(path.relative(ROOT, f)) && !f.endsWith("apply-email.ts") && !f.endsWith("apply-by-email.tsx"));
    expect(templates.length).toBeGreaterThan(0);
    for (const f of templates) expect(readFileSync(f, "utf8"), f).not.toMatch(/apply_email|applyEmail/);
  });

  it("the column is in the feed and detail select lists and in no other select list", () => {
    const columns = readFileSync(path.join(ROOT, "src/lib/jobs/job-columns.ts"), "utf8");
    expect(columns).toMatch(/JOB_DETAIL_COLUMNS =\s*"[^"]*\bapply_email\b/);
    expect(columns).not.toMatch(/JOB_EDIT_COLUMNS =\s*"[^"]*\bapply_email\b/);
    const feed = readFileSync(path.join(ROOT, "src/app/(app)/jobs/(feed)/page.tsx"), "utf8");
    const feedList = /const FEED_COLUMNS =\s*"([^"]*)"/.exec(feed)?.[1] ?? "";
    expect(feedList).toMatch(/\bapply_email\b/);
    const board = /const BOARD_AGGREGATE_COLUMNS =\s*"([^"]*)"/.exec(feed)?.[1] ?? "";
    expect(board.length).toBeGreaterThan(0);
    expect(board).not.toMatch(/apply_email/);
  });
});
