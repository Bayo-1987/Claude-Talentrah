/**
 * The standing check behind the Employer job import (CTO decision, 8 Oct): a surface that reads `source_type` to decide what to SHOW or DO with a posting must ask the shared link-out
 * predicate (src/lib/jobs/link-out.ts), because an imported posting is stored `internal` but applied for on the employer's own site. A NEW file under src/ that reads source_type without importing
 * the predicate fails here, so a new surface cannot silently treat an imported posting as an in-app application.
 *
 * Every other file is on the short allowlist below with ONE line saying why it may read source_type without the predicate. The list only shrinks: a new entry needs a reviewer's agreement in the PR
 * and a reason that is not "it works today" (the same ratchet as tests/ci/mock-factory-ratchet.test.ts).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const SRC = join(ROOT, "src");
const PREDICATE_IMPORT = /from "@\/lib\/jobs\/link-out"/;

const ALLOWLIST: Record<string, string> = {
  "src/app/(app)/auto-apply/page.tsx": "shows the queue row's stored apply mode (queueSourceType writes 'external' for anything link-out), not the posting's storage type",
  "src/lib/auto-apply/listable-pending.ts": "reads the queue row's stored apply mode (see auto-apply/page.tsx)",
  "src/app/employer/jobs/page.tsx": "lists the organisation's own postings, imported ones included; the 'Imported from your careers page' label and filter arrive with the employer UI (PR 4)",
  "src/lib/admin/moderation/queues.ts": "an operator tool that shows the storage type as data (reports and removed postings)",
  "src/lib/admin/moderation/search.ts": "an operator tool that shows the storage type as data",
  "src/lib/employer-verification-reminders/send.ts": "reminds an unverified organisation about its own waiting postings (imported ones included, which is correct: they are hidden until it verifies)",
  "src/lib/employer/actions.ts": "writes the employer's own postings and guards draft publishing; an imported posting is never a draft and is read-only in every employer action (PR 4 adds the Close/Hide actions)",
  "src/lib/jobs/expiry-reminders/extend.ts": "refuses a row without expires_at, and an imported posting carries none (it closes through its feed)",
  "src/lib/jobs/expiry-reminders/send.ts": "a comment only (the SQL functions it calls select internal postings that HAVE an expires_at; imported postings carry none)",
  "src/lib/jobs/expiry.ts": "the Talentrah expiry sweep: it now excludes imported postings explicitly (import_feed_id is null) and closes external ones through a separate path",
  "src/lib/jobs/ingest.ts": "the writer of aggregated (external) postings",
  "src/lib/jobs/job-columns.ts": "a list of column names, not a decision about a posting",
  "src/lib/seo/landing-page-data.ts": "selects the columns (including import_feed_id); the label decision is in public-landing.tsx, which uses the predicate",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).split("\\").join("/");
const readers = walk(SRC)
  .filter((p) => !p.endsWith("src/lib/supabase/types.ts") && !p.endsWith("src/lib/jobs/link-out.ts")) // the generated types, and the module that DEFINES the predicate
  .filter((p) => readFileSync(p, "utf8").includes("source_type"))
  .map(rel)
  .sort();

describe("every reader of source_type uses the link-out predicate or is on the reviewed allowlist", () => {
  it("found the readers (the check is not empty)", () => {
    expect(readers.length).toBeGreaterThan(15);
  });
  it("no file reads source_type without the predicate or an allowlist entry", () => {
    const offenders = readers.filter((f) => !PREDICATE_IMPORT.test(readFileSync(join(ROOT, f), "utf8")) && !(f in ALLOWLIST));
    expect(offenders, "a file that reads source_type must import the shared predicate (src/lib/jobs/link-out.ts) or be added to the allowlist with a reason").toEqual([]);
  });
  it("the allowlist only holds files that still read source_type and still lack the predicate (it shrinks, it is never padded)", () => {
    const stale = Object.keys(ALLOWLIST).filter((f) => !readers.includes(f) || PREDICATE_IMPORT.test(readFileSync(join(ROOT, f), "utf8")));
    expect(stale).toEqual([]);
  });
  it("every allowlist reason says something", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) expect(reason.length, file).toBeGreaterThan(30);
  });
});

describe("the specific read-only and expiry guarantees", () => {
  const source = (f: string) => readFileSync(join(ROOT, f), "utf8");
  it("the employer banner and assessment-file routes refuse an imported posting", () => {
    for (const f of ["src/app/api/employer/job-banner/route.ts", "src/app/api/employer/job-assessment-exercise/route.ts"]) {
      expect(source(f), f).toContain("import_feed_id");
      expect(source(f), f).toContain("isImportedPosting(job)");
    }
  });
  it("the Talentrah expiry sweep never closes an imported posting", () => {
    expect(source("src/lib/jobs/expiry.ts")).toMatch(/\.eq\("source_type", "internal"\)[\s\S]{0,300}\.is\("import_feed_id", null\)/);
  });
  it("the feed counts applicants only for postings applied for inside Talentrah", () => {
    expect(source("src/app/(app)/jobs/(feed)/page.tsx")).toContain("!isLinkOutPosting(s.job)");
  });
  it("search results carry the import marker the search RPC does not return", () => {
    expect(source("src/app/(app)/jobs/(feed)/page.tsx")).toContain("withImportMarkers(supabase, result.data)");
  });
});
