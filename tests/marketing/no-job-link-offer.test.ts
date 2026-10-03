/**
 * No user-facing string offers a job LINK or URL for tailoring (S1-43).
 *
 * Nothing in this codebase fetches a job URL for tailoring or the demo: `/tailor` and the homepage demo take pasted text only, and
 * the demo's route refuses a bare link ("We can't open a link yet"). The hero and the demo input already dropped "job link"; the
 * How it works step and /ai-resume-tailoring still offered it. This scan keeps every public and in-app string honest.
 *
 * Comments are stripped first (several explain WHY "job link" was removed). EXCEPTIONS are named, each with its reason; anything
 * else that matches fails with file:line.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** A string that offers a job link/URL, or "a link or the text/description". */
const OFFERS = [/\bjob\s+(link|url)s?\b/i, /\ba\s+link\s+or\s+(the\s+)?(full\s+)?(text|description|job)/i, /\blink\s+or\s+description\b/i];

/** Files where a URL is a legitimate thing to ask for, with the reason. */
const EXCEPTIONS: Record<string, string> = {
  "src/components/tracker/manual-entry-form.tsx": 'the Job Tracker\'s optional "Job URL" field: a manual entry records where the job was seen, and nothing fetches it',
};
/** Directories where fetching a pasted URL is the feature. */
const EXCEPTION_DIRS: Record<string, string> = {
  "src/components/employer/": "the employer careers-page import: an employer pastes a link to their OWN careers page and the server fetches it (src/lib/employer/job-import)",
  "src/lib/employer/": "the employer careers-page import and its prompts",
};

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(name) ? [rel] : [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, (_m, p) => `${p}`);

describe("no job link offered", () => {
  const files = walk("src");

  it("sees the tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/components/marketing/how-it-works-section.tsx");
  });

  it("the patterns catch the strings this scan exists for", () => {
    for (const bad of ["Paste a job link or description", "A link or the full text — whatever you have.", "Paste a job URL", "link or description"]) {
      expect(OFFERS.some((r) => r.test(bad)), bad).toBe(true);
    }
    for (const fine of ["Paste a job description", "We can't open a link yet — paste the job description text itself", "Paste a link to your careers page"]) {
      expect(OFFERS.some((r) => r.test(fine)), fine).toBe(false);
    }
  });

  it("every exception names a real file or directory (a stale exception would hide a future regression)", () => {
    for (const f of Object.keys(EXCEPTIONS)) expect(files, f).toContain(f);
    for (const d of Object.keys(EXCEPTION_DIRS)) expect(files.some((f) => f.startsWith(d)), d).toBe(true);
  });

  it("no string outside the named exceptions offers a job link or URL", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f in EXCEPTIONS || Object.keys(EXCEPTION_DIRS).some((d) => f.startsWith(d))) continue;
      stripComments(readFileSync(path.join(ROOT, f), "utf8")).split("\n").forEach((line, i) => {
        if (OFFERS.some((r) => r.test(line))) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    expect(offenders, "nothing fetches a job link: say 'paste a job description'").toEqual([]);
  });
});
