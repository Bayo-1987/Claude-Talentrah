/**
 * PR-E4 gate 2: the stored career-site address (job_postings.apply_link) is read by the redirect route and by nothing else that reaches a page. No API role can select it (0277); the pages hold only the
 * kind and the host. This scan keeps the list of files that name the column short and on purpose, and keeps it out of structured data, the embed widget, the alert e-mails and the share cards.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
/** The bare column name: not get_job_apply_link / set_job_apply_link (the function names), not apply_link_kind / apply_link_host. */
const BARE = /(?<![A-Za-z0-9_])apply_link(?![A-Za-z0-9_])/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|sql|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe("where the bare column is named under src/", () => {
  const ALLOWED = [
    "src/app/(app)/jobs/[id]/go/route.ts", // the redirect route: the only reader of the address (service role)
    "src/lib/supabase/types.ts", // generated types
    "src/app/(app)/jobs/(feed)/page.tsx", // type-only: the feed's Omit list names the column it never selects
    "src/components/jobs/job-card.tsx", // type-only: the card's prop type omits it
    "src/lib/matching/compute-and-store.ts", // type-only: the scoring row type omits it
    "src/lib/seo/job-posting-jsonld.ts", // type-only: the structured-data row type omits it
  ];
  // The sheet importer's own CSV column header is also called apply_link (parse.ts). It is a column of the file being imported, not the database column, and the importer is out of scope for this feature (IMPORT-IDN-HOST-1).
  const SHEET_HEADER = "src/lib/jobs/sheet-import/parse.ts";
  const named = sourceFiles(path.join(ROOT, "src"))
    .filter((f) => BARE.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f))
    .sort();
  it("only the allowlisted files name apply_link", () => {
    expect(named).toEqual([...ALLOWED, SHEET_HEADER].sort());
  });
  it("outside the route and the generated types, the name appears only inside a quoted Omit list", () => {
    for (const f of ALLOWED.filter((x) => !x.endsWith("route.ts") && !x.endsWith("types.ts"))) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      const rest = src.replace(/"apply_link"/g, "").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(BARE.test(rest), f).toBe(false);
    }
  });
});

describe("surfaces that must never carry the address or the redirect", () => {
  it.each([
    "src/lib/embed/widget-html.ts",
    "src/lib/digest/template.ts",
    "src/lib/proactive-match-alert/template.ts",
    "src/lib/seo/og-card.tsx",
    "src/app/(app)/jobs/[id]/opengraph-image.tsx",
    "src/app/sitemap.ts",
  ])("%s", (file) => {
    let src = "";
    try {
      src = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      return; // a surface that does not exist at this path cannot carry it
    }
    expect(src).not.toMatch(/apply_link|applyLink|\/go\b/);
  });
  it("the job page selects the kind and the host through the shared column list and never the address", () => {
    const page = readFileSync(path.join(ROOT, "src/app/(app)/jobs/[id]/page.tsx"), "utf8");
    expect(BARE.test(page.replace(/\/\/.*$/gm, ""))).toBe(false);
  });
});

describe("the host is never printed (CAPTION-1): it lives in the button's aria-label and nowhere a person reads", () => {
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const comp = strip(readFileSync(path.join(ROOT, "src/components/jobs/apply-on-company-site.tsx"), "utf8"));
  it("the component uses the host only inside a template string (the aria-label), never as rendered text", () => {
    const uses = [...comp.matchAll(/[^$]\{host\}|\$\{host\}/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((u) => u.startsWith("${"))).toBe(true);
    expect(comp).toMatch(/aria-label=\{`[^`]*\$\{host\}[^`]*`\}/);
  });
  it("the word 'Opens' as a capitalised caption appears in no source file under src/ except as part of a sentence in a comment", () => {
    const hits = sourceFiles(path.join(ROOT, "src"))
      .filter((f) => /\bOpens \{|>Opens |"Opens |`Opens /.test(strip(readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
