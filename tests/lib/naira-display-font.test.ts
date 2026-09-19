/**
 * send-401 regression guard.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * Newsreader (this app's `--font-display` serif, see globals.css) has no
 * reliable glyph for U+20A6 (₦), and its declared fallback chain
 * (`var(--font-newsreader), Georgia, "Times New Roman", serif`) doesn't
 * dependably supply one either. Confirmed with a real rendered screenshot of
 * `/employer/campaigns`: the wallet balance's "₦0", set in `font-display` at
 * 22px, rendered as something readable as "N0" — not a tofu box, an actively
 * wrong glyph shape, which is what makes it a legibility bug on a real money
 * figure rather than a cosmetic one. The SAME screen's body-font currency
 * strings ("Top up (₦)", the ₦10,000/₦25,000/₦50,000 preset buttons) render
 * correctly — Source Sans 3 (`--font-body`) does have the glyph. That's the
 * evidence the fix below relies on.
 *
 * Fixed by `NairaAmount` (src/components/ui/naira-amount.tsx): it wraps ONLY
 * the ₦ sign in `font-body`, inline, while leaving the numerals in whatever
 * font the surrounding element already declares. That keeps the established
 * convention of big numbers living in `font-display` (see
 * `MatchTierBadge`'s own 46px score, which is unaffected — plain digits and
 * "%" render fine in Newsreader; this was never "Newsreader can't do
 * numbers", only the currency glyph specifically).
 *
 * Thirteen call sites across six files had this exact shape before the fix:
 * src/components/employer/wallet-topup.tsx,
 * src/app/employer/campaigns/[id]/page.tsx (x4),
 * src/app/employer/campaigns/[id]/analytics/page.tsx (x3),
 * src/app/employer/analytics/page.tsx,
 * src/app/(app)/billing/page.tsx (x3),
 * src/app/admin/(protected)/mentor-payouts/page.tsx.
 * All were converted to `<NairaAmount amount={...} />`.
 *
 * ── WHAT THIS TEST CATCHES ──────────────────────────────────────────────────
 *
 * Two shapes a regression could take, mirroring the two the real bug
 * actually took:
 *
 *   (A) A raw "₦" character literal embedded directly in an element whose
 *       className carries `font-display` (this was billing/page.tsx's shape
 *       — `<p className="font-display ...">₦{amount.toLocaleString()}</p>`).
 *   (B) A call to a LOCAL string-returning currency helper — this file's own
 *       `const naira = (n) => \`₦${n...}\`` / `const money = (n) => ...`
 *       pattern — inside a `font-display` element (this was
 *       wallet-topup.tsx's and the campaign pages' shape). Several files
 *       legitimately keep such a helper for BODY-font strings elsewhere in
 *       the same file (e.g. wallet-topup.tsx's "about N days at ₦X/day"
 *       copy) — this only flags a call to it that lands near `font-display`.
 *
 * `NairaAmount`'s own file is exempt (it's the one place a raw "₦" is
 * supposed to sit right next to a font declaration), and it is proven below
 * to actually apply `font-body` to the sign, so the exemption isn't just
 * trusting the filename.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../src");
const NAIRA_AMOUNT_REL_PATH = "components/ui/naira-amount.tsx";

function findSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function rel(absPath: string): string {
  return path.relative(SRC_ROOT, absPath).split(path.sep).join("/");
}

/** Same approach as tests/lib/match-confidence-enforcement.test.ts's own helper. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Local `const naira = (n) => \`₦...\`` / `const money = (n) => \`₦...\`` style helpers. */
function localCurrencyHelperNames(source: string): string[] {
  const names: string[] = [];
  const re = /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*`₦/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.push(m[1]);
  return names;
}

/**
 * Lines (1-indexed in the messages) where a raw "₦" or a call to a local
 * currency helper sits within two lines of a `font-display` className —
 * close enough to be the same JSX element in every real occurrence this bug
 * ever took, given this repo's convention of one attribute per line.
 */
function fontDisplayCurrencyViolations(source: string): string[] {
  const helperNames = localCurrencyHelperNames(source);
  const helperCallRe = helperNames.length
    ? new RegExp(`\\b(${helperNames.join("|")})\\(`)
    : null;

  const lines = stripComments(source).split("\n");
  const hits: string[] = [];
  lines.forEach((line, i) => {
    const hasRawSign = line.includes("₦");
    const hasHelperCall = helperCallRe ? helperCallRe.test(line) : false;
    if (!hasRawSign && !hasHelperCall) return;

    const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
    if (window.includes("font-display")) {
      hits.push(`line ${i + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe("naira-amount font-glyph regression guard (send-401)", () => {
  it("found source files to scan — a suite that checks nothing proves nothing", () => {
    expect(findSourceFiles(SRC_ROOT).length).toBeGreaterThan(50);
  });

  it("NairaAmount actually renders the ₦ sign inside a font-body span", () => {
    const source = readFileSync(path.join(SRC_ROOT, NAIRA_AMOUNT_REL_PATH), "utf8");
    // The exact mechanism the fix relies on: font-body wraps the sign, not
    // the whole amount, so the inherited font-display keeps styling the
    // numerals.
    expect(source).toMatch(/font-body"[^>]*>\s*₦/);
  });

  describe("no source file embeds a currency sign inside a font-display element", () => {
    const offenders = findSourceFiles(SRC_ROOT)
      .filter((f) => rel(f) !== NAIRA_AMOUNT_REL_PATH)
      .map((f) => ({ path: rel(f), hits: fontDisplayCurrencyViolations(readFileSync(f, "utf8")) }))
      .filter((o) => o.hits.length > 0);

    it("has no offenders", () => {
      expect(
        offenders.map((o) => `${o.path}:\n  ${o.hits.join("\n  ")}`),
        "these files render a ₦ amount directly inside a font-display element — Newsreader has no " +
          "reliable glyph for U+20A6 (see this file's own header). Use <NairaAmount amount={...} /> " +
          "(src/components/ui/naira-amount.tsx) instead, the way every other font-display currency " +
          "figure in this app now does.",
      ).toEqual([]);
    });
  });

  describe("proof this scan catches the real pre-fix shapes (prove-the-test-catches-the-bug discipline)", () => {
    it("would have failed on wallet-topup.tsx's own pre-fix shape (helper call)", () => {
      const preFix = [
        'const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;',
        "",
        '        <span className="font-display text-[22px] font-medium text-ink">{naira(balanceNgn)}</span>',
      ].join("\n");
      expect(fontDisplayCurrencyViolations(preFix)).toHaveLength(1);
    });

    it("would have failed on billing/page.tsx's own pre-fix shape (raw literal)", () => {
      const preFix = [
        '              <p className="font-display text-[24px]">',
        "                ₦{pack.price_ngn.toLocaleString()}",
        "              </p>",
      ].join("\n");
      expect(fontDisplayCurrencyViolations(preFix)).toHaveLength(1);
    });

    it("does NOT fire on the fixed shape (<NairaAmount />)", () => {
      const fixed = [
        'import { NairaAmount } from "@/components/ui";',
        "",
        '        <span className="font-display text-[22px] font-medium text-ink">',
        "          <NairaAmount amount={balanceNgn} />",
        "        </span>",
      ].join("\n");
      expect(fontDisplayCurrencyViolations(fixed)).toHaveLength(0);
    });

    it("does NOT false-positive on a currency helper used only in font-body contexts", () => {
      const unrelated = [
        'const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;',
        "",
        '        <span className="font-body text-[13px] text-ink-soft">{naira(dailyCommitmentNgn)}/day</span>',
      ].join("\n");
      expect(fontDisplayCurrencyViolations(unrelated)).toHaveLength(0);
    });
  });
});
