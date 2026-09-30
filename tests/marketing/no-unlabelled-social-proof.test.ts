/**
 * send-476 — visitor-facing social proof has to be honest, and CI has to notice
 * when it stops being.
 *
 * Three things were found shipping on the public site, none of them caught by
 * anything:
 *   1. an attributed testimonial ("Amaka O., Product Manager, Lagos … three
 *      interviews booked within two weeks") on every login/signup page, with no
 *      visible label — only a code comment said it was invented;
 *   2. "hundreds of other companies" on the homepage, when production has 56
 *      companies behind its 662 open postings;
 *   3. hardcoded sample listings attributed to REAL companies (Flutterwave,
 *      Paystack, Andela) that have no postings in our data at all — under a
 *      footnote claiming their scores were "calculated against a sample
 *      resume", which sample-resume.ts itself says was untrue of that grid.
 *
 * CLAUDE.md §6.1 already says "no invented social proof/stats". This turns that
 * sentence into something that fails.
 *
 * ── WHAT THIS CAN AND CANNOT CATCH ──────────────────────────────────────────
 *
 * It is a text-shape check over source files, not a proof. KNOWN GAP: a quote
 * written inline in JSX, with no `TESTIMONIAL` constant and no
 * `&ldquo;{value}&rdquo;` interpolation, slips past case 1. So does a scale
 * claim phrased differently ("a huge number of employers"). The sturdier fix
 * is to allow quotes only through one <Testimonial> component fed by a
 * registry of consented entries, and lint for everything else — deliberately
 * not built until a real, consented testimonial exists.
 *
 * When a real, consented testimonial does exist, case 1 SHOULD start failing
 * until someone extends it on purpose; that friction is the point.
 *
 * No database, no Supabase env: this only reads source.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The visitor-facing surface: marketing, auth, the public mentorship landing
// and the public pages under src/app. Not admin, dev, api, or the signed-in
// (app) group — those are a different audience and a different rule.
const ROOTS = ["src/components/marketing", "src/components/auth", "src/components/mentorship", "src/app"];
const SKIP = /(^|\/)(admin|dev|api|\(app\))(\/|$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.test(path)) continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(root));

// Comments describe the code; only what renders can mislead a visitor.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (path: string) => strip(readFileSync(path, "utf8"));

// An attributed quote: a named testimonial constant, or an interpolated pull-quote.
const TESTIMONIAL_SHAPE = /const\s+TESTIMONIALS?\b|&ldquo;\{[A-Za-z_.]+\}&rdquo;/;
// A label a visitor can actually read next to it.
const ILLUSTRATIVE_LABEL = /illustrative example|example only|not a real (user|person|review)/i;
// A vague scale claim a visitor reads as a measured fact.
const SCALE_CLAIM = /\b(hundreds|thousands|millions) of (other )?(companies|employers|job ?seekers|users|people)\b/i;

const HOMEPAGE_SAMPLE_LISTINGS = "src/components/marketing/job-board-preview.tsx";

/**
 * A TRIPWIRE, not a proof — a list of real names can never be complete. It
 * holds the three brands the homepage actually used, plus the employers that
 * dominate our own postings and the best-known Nigerian fintechs a copywriter
 * would reach for next. The structural protection is the field allowlist
 * below: sample rows carry NO company field at all, so there is nowhere for a
 * name — real or invented — to live.
 */
const REAL_COMPANY_TRIPWIRE = [
  "Flutterwave", "Paystack", "Andela",
  "Moniepoint", "Renmoney", "FairMoney", "Kuda", "Jumia", "Reliance Health", "One Acre Fund",
  "Interswitch", "Opay", "Paga", "Cowrywise", "PiggyVest",
];

/**
 * The only fields a homepage sample listing may have. Adding a `company`,
 * `employer` or similar field fails the test on purpose: to add one, someone
 * has to edit this list and defend it in review, which is the friction that
 * would have stopped "Flutterwave · Paystack · Andela" shipping.
 */
const ALLOWED_SAMPLE_FIELDS = new Set(["score", "tier", "role", "industry", "location", "workType"]);

describe("visitor-facing social proof must be honest (send-476)", () => {
  it("CONTROL: the scanner sees the files it is meant to police", () => {
    // Without this, every case below could pass by scanning nothing.
    expect(files.some((f) => f.endsWith("components/auth/auth-hero.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith(HOMEPAGE_SAMPLE_LISTINGS))).toBe(true);
    expect(files.some((f) => f.endsWith("components/marketing/jd-demo-example.tsx"))).toBe(true);
    // ...and the patterns can match the shapes they exist for.
    expect(TESTIMONIAL_SHAPE.test("const TESTIMONIAL = {")).toBe(true);
    expect(SCALE_CLAIM.test("and hundreds of other companies")).toBe(true);
  });

  it("case 1 — no attributed testimonial without a visible 'illustrative example' label", () => {
    const offenders = files.filter((f) => {
      const src = read(f);
      return TESTIMONIAL_SHAPE.test(src) && !ILLUSTRATIVE_LABEL.test(src);
    });
    expect(offenders, `unlabelled testimonial in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("case 2 — no unmeasured 'hundreds/thousands of …' scale claim in visitor copy", () => {
    const offenders = files.filter((f) => SCALE_CLAIM.test(read(f)));
    expect(offenders, `unmeasured scale claim in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("case 3 — homepage sample listings have no company field and name no real company, and say they are examples", () => {
    const src = read(HOMEPAGE_SAMPLE_LISTINGS);

    // The SAMPLE_LISTINGS array literal.
    const block = src.match(/const SAMPLE_LISTINGS\s*=\s*\[([\s\S]*?)\n\];/)?.[1];
    expect(block, "could not find the SAMPLE_LISTINGS array to check").toBeTruthy();

    // Control: extraction found real rows, so an empty block can't pass.
    const rows = (block!.match(/score:/g) ?? []).length;
    expect(rows, "found no sample listing rows to check").toBeGreaterThanOrEqual(3);

    // (a) no company field: every key must be on the allowlist.
    const keys = new Set([...block!.matchAll(/^\s*([A-Za-z]+):/gm)].map((m) => m[1]!));
    const unexpected = [...keys].filter((k) => !ALLOWED_SAMPLE_FIELDS.has(k));
    expect(
      unexpected,
      `sample listing fields not on the allowlist (a company field is not allowed): ${unexpected.join(", ")}`,
    ).toEqual([]);

    // (b) tripwire: no real company name anywhere in the component's rendered source.
    const real = REAL_COMPANY_TRIPWIRE.filter((name) => new RegExp(`\\b${name}\\b`, "i").test(src));
    expect(real, `homepage sample block names real companies: ${real.join(", ")}`).toEqual([]);

    // (c) the block is labelled as example listings, at the top and in the footnote.
    expect(src, "the sample block is not labelled 'Example listings'").toMatch(/Example listings/);
    expect(src, "the footnote does not say the listings are for illustration only").toMatch(
      /Example listings for illustration only/,
    );
  });
});
