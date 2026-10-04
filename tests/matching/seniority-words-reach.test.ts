/**
 * Where can the seniority words be REACHED from? They are written from one side: the seeker's ("More senior than you") or, for the employer
 * applicants page, the employer's ("Above the role's level"). Seeker wording must never be reachable from an email, a notification, an export, an
 * admin page, an employer page (other than through the employer perspective), or any shared or public page.
 *
 * Two independent checks, both over the whole of `src/`:
 *   1. THE PHRASES themselves occur in exactly one file, the helper. Nothing else can spell them.
 *   2. THE IMPORT GRAPH: every file that can reach the helper chain (the helper, the Vet summary, the breakdown component, Farah's job context)
 *      through imports is on an explicit list of seeker surfaces. Set EQUALITY: a new surface that reaches the words fails here until someone adds
 *      it on purpose, and a stale entry fails too.
 * A new email, notification or export that wants to show these words has to import the helper, so it lands in check 2.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const FILES = walk("src");
const HELPER = "src/lib/matching/seniority-words.ts";

describe("the phrases", () => {
  const PHRASES = [
    "more senior than you",
    "more junior than you",
    "more senior than your current level",
    "more junior than your current level",
    "seniority looks right for you",
    "seniority isn't clear from the posting",
  ];
  it("occur in exactly one file of src/: the helper (so no email, notification, export or page can spell them itself)", () => {
    const holders = FILES.filter((f) => {
      const text = readFileSync(f, "utf8").toLowerCase();
      return PHRASES.some((p) => text.includes(p));
    });
    expect(holders).toEqual([HELPER]);
  });
});

/** Resolve an import specifier to a file under src/, or null (a package, or something that is not source). */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(from), spec)) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const r = resolve(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

describe("the import graph", () => {
  // The chain: helper <- vet-summary <- Farah's job context (token-budget); helper <- the breakdown component.
  const CHAIN_ROOTS = [HELPER];

  /**
   * Every file that can reach a root through imports (a root itself counts). One edge is read at SYMBOL level: `token-budget.ts` is mostly
   * constants (Farah's client imports one for its output budget) and only `buildJobContext` carries the seniority words, so an import of that file
   * counts only when the importing file actually names `buildJobContext`.
   */
  const BUDGET_MODULE = "src/lib/farah/token-budget.ts";
  const graph = new Map(FILES.map((f) => [f, importsOf(f)]));
  const usesJobContext = (file: string) => /\bbuildJobContext\b/.test(readFileSync(file, "utf8"));
  const reach = new Set<string>(CHAIN_ROOTS);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [file, imports] of graph) {
      if (!reach.has(file) && imports.some((i) => reach.has(i) && (i !== BUDGET_MODULE || usesJobContext(file)))) {
        reach.add(file);
        changed = true;
      }
    }
  }

  /**
   * Every surface that can reach the words, and why it is allowed. Seeker surfaces show the seeker's wording to the seeker whose resume was scored.
   * The employer applicants page reaches them only through the employer perspective (tests/employer/applicant-seniority-wording.test.tsx).
   */
  const ALLOWED: Record<string, string> = {
    [HELPER]: "the one place the words live",
    "src/lib/matching/vet-summary.ts": "the summary sentence, whose only production consumer is Farah's job context (seeker)",
    "src/components/jobs/match-breakdown.tsx": "the Seniority cell; takes a perspective prop",
    "src/lib/farah/token-budget.ts": "Farah's job context for the seeker's chat",
    "src/app/api/farah/chat/route.ts": "builds that context for the signed-in seeker only",
    "src/components/jobs/job-card.tsx": "the feed card (seeker)",
    "src/app/(app)/jobs/(feed)/page.tsx": "the job feed (seeker)",
    "src/app/(app)/jobs/[id]/page.tsx": "the job detail page (seeker)",
    "src/app/(app)/jobs/[id]/opengraph-image.tsx": "public share image: imports one helper (dedupeMetaParts) from the card and renders no seniority (asserted below)",
    "src/components/employer/applicant-list.tsx": "employer applicants list: passes perspective=\"employer\" (tested)",
    "src/app/employer/jobs/[id]/applicants/page.tsx": "renders the employer applicants list",
  };

  it("exactly the listed surfaces can reach the seniority words (set equality, so a new email, notification, export or page fails until added on purpose)", () => {
    expect([...reach].sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("no email, notification, digest, export, admin, public or marketing file is on the list", () => {
    const forbidden = [...reach].filter((f) => /src\/lib\/(email|digest|notifications|auto-apply-digest|account-deletion|resend|reports|scholarship-deadline-alerts|employer-verification-reminders|seo)\b|src\/app\/(admin|blog|legal|vs|about|contact|unsubscribe|extend-posting|how-match-scores-work|how-auto-apply-works|ai-|ats-)|src\/app\/page\.tsx|src\/app\/sitemap|src\/app\/\(auth\)/.test(f));
    expect(forbidden).toEqual([]);
  });

  it("the public share image imports only dedupeMetaParts from the card and renders no breakdown", () => {
    const text = readFileSync("src/app/(app)/jobs/[id]/opengraph-image.tsx", "utf8");
    expect(text).toMatch(/import \{ dedupeMetaParts \} from "@\/components\/jobs\/job-card"/);
    expect(text).not.toMatch(/MatchBreakdown|seniority|fitSummary/i);
  });
});
