/**
 * send-478 — the two comparison pages (/vs/jobright, /vs/jobcopilot) make
 * factual claims about named competitors. A source check on 2026-09-30 found:
 *
 *   - an absolute claim nobody had tested ("doesn't work outside the US",
 *     "no workaround", "don't return usable results from Nigeria at all") —
 *     the only source tested the UK, Europe and India, never Nigeria;
 *   - a competitor price described as "not published" that the competitor now
 *     publishes, in naira;
 *   - competitor prices with no date and no link to where they came from;
 *   - the competitor's product named "JobCopilot" while a different product,
 *     jobcopilot.com, exists.
 *
 * This turns the mechanical part of that into something that fails. It cannot
 * make a claim TRUE; it can only stop the shapes of claim that were wrong here
 * from coming back unnoticed.
 *
 * ── DELIBERATELY NOT HERE: a test that fails when a source date gets old ─────
 *
 * A "checked more than N days ago" assertion would turn red on its own as time
 * passes and break unrelated PRs for a reason nobody on those PRs can act on.
 * Re-checking is a calendar job (a recurring source check), not a CI gate.
 *
 * ── LIMITS ──────────────────────────────────────────────────────────────────
 *
 * Text-shape checks over source. The absolute-phrase list is small on purpose
 * and is not exhaustive: it forces a reviewer to look, and a softer wording
 * ("reported as", "in practice") is the fix, not a rewording that dodges the
 * regex. The price rule is a proximity heuristic — a month-year and a URL within
 * PRICE_WINDOW characters — not proof that they belong to that price. "Ours" is
 * decided by amount against our own catalog, so a competitor price that happens
 * to equal one of ours would be treated as ours.
 *
 * No database, no Supabase env: this only reads source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CREDIT_PACKS, PASSES } from "@/lib/billing/catalog";

const JOBRIGHT = "src/app/vs/jobright/page.tsx";
const JOBCOPILOT = "src/app/vs/jobcopilot/page.tsx";
const VS_PAGES = [JOBRIGHT, JOBCOPILOT];

/**
 * Comments describe the code and (here) hold the source notes; only what
 * renders can mislead a visitor. Then flatten: JSX wraps text across lines
 * ("there's no\n   workaround") and writes apostrophes as entities, both of
 * which would let a phrase slip past a naive match.
 */
function rendered(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/&apos;|&#39;|&rsquo;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/\s+/g, " ");
}

/**
 * Absolute forms. Each one asserts a fact about a competitor that a review can
 * only ever partly support (a source saw certain places, on a certain date):
 *   "no workaround"  — cannot be proven from outside the product
 *   "doesn't work"   — the old H1 said Jobright "doesn't work outside the US"
 *   "at all"         — "don't return usable results from Nigeria at all"
 *   "only real"      — a superlative about the competitor's field
 */
const ABSOLUTE_PHRASES = ["no workaround", "doesn't work", "at all", "only real"];

const MONTH_YEAR =
  /(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/;
const URL = /https?:\/\/[^\s"'<>)]+/;
const AMOUNT = /(?:[$£€₦]|NGN |USD )\s?(\d[\d,]*(?:\.\d+)?)/g;
const PRICE_WINDOW = 700;

/** Amounts that are ours, straight from the catalog so they cannot drift. */
const OUR_AMOUNTS = new Set<number>([...CREDIT_PACKS, ...PASSES].map((p) => p.price_ngn));

describe("the /vs comparison pages make honest, sourced claims (send-478)", () => {
  it("CONTROL: the scanner reads both pages and each rule can fire", () => {
    for (const p of VS_PAGES) expect(rendered(p).length, `${p} rendered as empty`).toBeGreaterThan(1000);
    expect(rendered(JOBRIGHT)).toContain("Jobright");
    expect(rendered(JOBCOPILOT)).toContain("JobCopilot");
    // The normaliser flattens what would otherwise hide a phrase.
    const flat = "there&apos;s no\n      workaround".replace(/&apos;/g, "'").replace(/\s+/g, " ");
    expect(flat.includes("no workaround")).toBe(true);
    // Our own catalog yields amounts, so the "ours" set is not empty.
    expect(OUR_AMOUNTS.size).toBeGreaterThanOrEqual(3);
    expect(OUR_AMOUNTS.has(6500)).toBe(true);
  });

  it("case 1 — no absolute claim about a competitor (a small list, on purpose)", () => {
    const hits = VS_PAGES.flatMap((p) => {
      const text = rendered(p).toLowerCase();
      return ABSOLUTE_PHRASES.filter((phrase) => new RegExp(`\\b${phrase}\\b`).test(text)).map(
        (phrase) => `${p}: "${phrase}"`,
      );
    });
    expect(hits, `absolute phrases on the comparison pages:\n  ${hits.join("\n  ")}`).toEqual([]);
  });

  it("case 2 — every competitor price sits next to a month-year and a link to where it came from", () => {
    const problems: string[] = [];
    let competitorAmounts = 0;
    for (const p of VS_PAGES) {
      const text = rendered(p);
      for (const m of text.matchAll(AMOUNT)) {
        const value = Number(m[1]!.replace(/,/g, ""));
        if (OUR_AMOUNTS.has(value)) continue;
        competitorAmounts += 1;
        const window = text.slice(Math.max(0, m.index! - PRICE_WINDOW), m.index! + m[0].length + PRICE_WINDOW);
        if (!MONTH_YEAR.test(window)) problems.push(`${p}: ${m[0]} has no month-year nearby`);
        if (!URL.test(window)) problems.push(`${p}: ${m[0]} has no link nearby`);
      }
    }
    // Control: there ARE competitor prices to check, so passing is not vacuous.
    expect(competitorAmounts, "found no competitor prices at all — the rule is checking nothing").toBeGreaterThan(0);
    expect(problems, `competitor prices without a dated, linked source:\n  ${problems.join("\n  ")}`).toEqual([]);
  });

  it("case 3 — the Jobright page keeps the search phrase it targets in its title and H1", () => {
    const src = readFileSync(JOBRIGHT, "utf8");
    const title = src.match(/title:\s*"([^"]+)"/)?.[1] ?? "";
    expect(title, "could not read the page title").not.toBe("");
    expect(title).toMatch(/Jobright Alternative/i);
    const h1 = (src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "").replace(/&apos;/g, "'").replace(/\s+/g, " ");
    expect(h1, "could not read the page H1").not.toBe("");
    expect(h1).toMatch(/Jobright alternative/i);
    expect(h1).toMatch(/Nigeria/);
  });

  it("case 4 — the competitor is always named FreshTalent JobCopilot, in the metadata and the copy", () => {
    const text = rendered(JOBCOPILOT).replace(/https?:\/\/[^\s"'<>)]+/g, "");
    const bare = [...text.matchAll(/(?<!FreshTalent )JobCopilot/g)].length;
    expect(bare, `${bare} mention(s) of "JobCopilot" not preceded by "FreshTalent"`).toBe(0);

    const src = readFileSync(JOBCOPILOT, "utf8");
    const title = src.match(/title:\s*"([^"]+)"/)?.[1] ?? "";
    const description = src.match(/description:\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(title).toContain("FreshTalent JobCopilot");
    expect(description).toContain("FreshTalent JobCopilot");
    // The Jobright page links across to it: same name there.
    const across = rendered(JOBRIGHT).replace(/https?:\/\/[^\s"'<>)]+/g, "");
    expect([...across.matchAll(/(?<!FreshTalent )JobCopilot/g)].length).toBe(0);
  });
});
