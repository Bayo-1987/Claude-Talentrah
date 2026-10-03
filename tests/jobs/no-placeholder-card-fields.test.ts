/**
 * A card field renders only when it carries a real value for that job. No "not yet", "N/A" or "unavailable" placeholders.
 * (#635 did this for the applicant count; S3-23a did it for the match breakdown's Industry cell and "Not available".)
 *
 * Scans the job card, everything it composes and the job detail page for the placeholder phrases, in string literals and JSX text (comments are
 * ignored, since a comment may legitimately explain why a placeholder was removed).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "src/components/jobs");
// The card and everything it composes, plus the job DETAIL page (its own fields: seniority, salary, work type, the breakdown
// host), which renders the same facts and is where a placeholder would otherwise survive.
const FILES = [
  ...readdirSync(DIR).filter((f) => f.endsWith(".tsx")).map((f) => path.join(DIR, f)),
  path.join(process.cwd(), "src/components/ui/match-tier-badge.tsx"),
  path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"),
];

const BANNED = [/not yet measured/i, /flagged, not scored/i, /not available/i, /\bN\/A\b/, /\bunavailable\b/i, /\bnot yet\b/i, /coming soon/i];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("no placeholder phrases in the job card's output", () => {
  for (const file of FILES) {
    it(path.relative(process.cwd(), file), () => {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const re of BANNED) expect(code, `${re} in ${path.basename(file)}`).not.toMatch(re);
    });
  }
});
