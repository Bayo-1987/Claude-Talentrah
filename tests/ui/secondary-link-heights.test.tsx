/**
 * QA-1: standalone secondary links are at least 24px tall (the owner's rule; WCAG 2.2 AA 2.5.8). The Playwright spec e2e/secondary-link-heights.spec.ts measures every
 * public page in a browser; this file is its fast, database-free half: it pins the classes that make each known offender tall enough, so a change that drops one fails here
 * with the file and the link rather than only in CI's browser run. (A class is not the measure; the spec is. Both exist because the classes alone once passed a link that
 * still measured short.)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

/** The minimum height, in px, a class list guarantees (Tailwind's min-h-N is N*4px, min-h-[Npx] is N), or 0. */
function minHeightPx(classes: string): number {
  let best = 0;
  for (const c of classes.split(/\s+/)) {
    const scale = /^min-h-(\d+(?:\.\d+)?)$/.exec(c);
    if (scale) best = Math.max(best, Number(scale[1]) * 4);
    const arbitrary = /^min-h-\[(\d+(?:\.\d+)?)px\]$/.exec(c);
    if (arbitrary) best = Math.max(best, Number(arbitrary[1]));
  }
  return best;
}
/** The class list of the first JSX element in `source` that has `needle` in its props and a className after it. */
function classOfLinkWith(source: string, needle: string): string {
  const i = source.indexOf(needle);
  if (i === -1) throw new Error(`no ${needle}`);
  const m = /className="([^"]*)"/.exec(source.slice(i, i + 400));
  if (!m) throw new Error(`no className after ${needle}`);
  return m[1];
}

describe("the footer: every link is its own target of at least 24px", () => {
  const html = renderToStaticMarkup(MarketingFooter());
  const anchors = [...html.matchAll(/<a\s[^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  it("renders the footer's links (the check is not empty)", () => {
    expect(anchors.length).toBeGreaterThanOrEqual(14);
  });
  it("each one carries a minimum height of at least 24px", () => {
    for (const cls of anchors) expect(minHeightPx(cls), cls).toBeGreaterThanOrEqual(24);
  });
});

describe("the homepage's links under the demo box (every quick action and 'Browse jobs instead')", () => {
  const source = read("src/components/marketing/jd-demo-input.tsx");
  it("each underlined link has at least 24px", () => {
    const classes = [...source.matchAll(/<Link\b[^>]*?className="([^"]*underline underline-offset-3[^"]*)"/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThanOrEqual(3);
    for (const cls of classes) expect(minHeightPx(cls), cls).toBeGreaterThanOrEqual(24);
  });
});

describe("'Forgot password?' on the login form", () => {
  it("is at least 24px tall", () => {
    expect(minHeightPx(classOfLinkWith(read("src/components/auth/login-form.tsx"), 'href="/forgot-password"'))).toBeGreaterThanOrEqual(24);
  });
});

describe("the list titles that are links", () => {
  it("a job's title link on the public job list is at least 24px tall", () => {
    expect(minHeightPx(classOfLinkWith(read("src/components/jobs/public-job-row.tsx"), "href={`/jobs/${job.id}`}"))).toBeGreaterThanOrEqual(24);
  });
  it("a scholarship's title link is at least 24px tall", () => {
    expect(minHeightPx(classOfLinkWith(read("src/components/scholarships/scholarship-card.tsx"), "href={`/scholarships/${scholarship.id}`}"))).toBeGreaterThanOrEqual(24);
  });
});

describe("every title link on a list, card or landing row (CI found two the named checks above missed)", () => {
  /** The class signature of a list-title link: ink text, no underline until hover. Found by scanning src, so a NEW row component with the same link fails too. */
  const SIGNATURE = "no-underline hover:text-rust hover:underline";
  const TITLE_LINK = /<Link\b[^>]*?className="([^"]*no-underline hover:text-rust hover:underline[^"]*)"/g;
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.tsx$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const found = walk("src").flatMap((file) => [...read(file).matchAll(TITLE_LINK)].map((m) => ({ file, cls: m[1] })));
  it("finds the known title links (the scan is not empty)", () => {
    const files = new Set(found.map((f) => f.file));
    for (const f of [
      "src/components/jobs/job-card.tsx",
      "src/components/jobs/public-job-row.tsx",
      "src/components/jobs/public-landing.tsx",
      "src/components/scholarships/public-scholarship-row.tsx",
      "src/components/scholarships/scholarship-card.tsx",
      "src/components/scholarships/public-landing.tsx",
    ])
      expect(files.has(f), f).toBe(true);
    expect(SIGNATURE.length).toBeGreaterThan(0);
  });
  it("each carries a minimum height of at least 24px", () => {
    const short = found.filter(({ cls }) => minHeightPx(cls) < 24).map(({ file }) => file);
    expect(short).toEqual([]);
  });
});

describe("the browser spec is in the normal e2e config, so CI runs it", () => {
  const spec = existsSync(path.join(ROOT, "e2e/secondary-link-heights.spec.ts")) ? read("e2e/secondary-link-heights.spec.ts") : "";
  it("exists, measures 24px with getBoundingClientRect, and covers the eight pages at both widths", () => {
    expect(spec).toMatch(/const MIN = 24;/);
    expect(spec).toContain("getBoundingClientRect()");
    for (const p of ["/", "/jobs", "/login", "/signup", "/scholarships", "/mentorship", "/how-we-review-resumes", "/blog"]) expect(spec).toContain(`"${p}"`);
    expect(spec).toMatch(/for \(const width of \[360, 1440\]\)/);
  });
  it("needs no special config: it imports plain @playwright/test and nothing from a QA-only config", () => {
    expect(spec).toContain('from "@playwright/test"');
    expect(spec).not.toMatch(/qa\.config|baseURL:/);
    expect(existsSync(path.join(ROOT, "e2e/qa.config.ts"))).toBe(false);
  });
});
