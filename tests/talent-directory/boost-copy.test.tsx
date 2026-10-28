/**
 * V5 copy (V5-LABEL-AND-COPY-1): what a seeker is told a boost buys. Since migration 0268 a boost no longer puts a candidate first in the list; it gives a rotating seat in a labelled "Promoted" strip of at most three
 * boosted candidates, fixed for one UTC hour and moving every hour, on the first page only. Two seeker-facing strings still promised "the top":
 *   - src/lib/talent-directory/boost-runner.ts:109, the message after a successful purchase ("You're now boosted to the top of search results ..."), and
 *   - src/app/(app)/talent-directory/verify/boost-panel.tsx:27, the panel above the button ("Move to the top of employer search results ...", and "on top of your current one").
 * Both must now say a boost gives a rotating seat in the Promoted strip for N days, and neither may contain the word "top" in any form a seeker reads.
 *
 * The exact final wording is pinned below (the repo's habit for words that carry a promise), the word "Promoted" comes from the one constant (tests/talent-directory/promoted-label.test.tsx), and the two
 * facts the copy states (three seats, an hourly rotation) are pinned to the migration so they cannot drift from what the database does.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));
vi.mock("@/lib/talent-directory/actions", () => ({
  requestTalentVerificationAction: async () => ({}),
  requestHumanReviewVerificationAction: async () => ({ status: "idle", message: null }),
  requestTalentDirectoryBoostAction: async () => ({}),
}));

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Code with comments removed: a comment may still say what the old behaviour was. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const TOP = /\btop\b|\btop-|-top\b|\bfirst place\b|\bfirst in\b|\bat the front\b|\bhighest\b|\bahead of\b/i;

describe("the boost panel (what the seeker reads before paying)", () => {
  it("says a boost gives a rotating seat in the Promoted strip for 7 days, and the price", async () => {
    const { BoostPanel } = await import("@/app/(app)/talent-directory/verify/boost-panel");
    const t = plain(renderToStaticMarkup(<BoostPanel boostedUntil={null} />));
    expect(t).toContain("A boost gives you a rotating seat in the Promoted strip on employer search for 7 days — 10 credits.");
    expect(t).toContain("The strip shows up to 3 boosted candidates at a time and rotates every hour, so a seat is not a fixed position.");
    expect(t).toContain("Purchases stack: buying again while already boosted adds 7 more days to your current boost.");
  });

  it("the price in the sentence is the live price from CREDIT_COSTS, not a typed-in number", async () => {
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/lib/credits/costs")>();
      return { ...real, CREDIT_COSTS: { ...real.CREDIT_COSTS, talentDirectoryBoost: 77 } };
    });
    try {
      const { BoostPanel } = await import("@/app/(app)/talent-directory/verify/boost-panel");
      const t = plain(renderToStaticMarkup(<BoostPanel boostedUntil={null} />));
      expect(t).toContain("for 7 days — 77 credits.");
      expect(t).not.toContain("— 10 credits.");
    } finally {
      vi.doUnmock("@/lib/credits/costs");
      vi.resetModules();
    }
  });

  it("never promises the top, in the idle, active and expired states", async () => {
    const { BoostPanel } = await import("@/app/(app)/talent-directory/verify/boost-panel");
    for (const until of [null, "2099-01-01T00:00:00Z", "2020-01-01T00:00:00Z"]) {
      const t = plain(renderToStaticMarkup(<BoostPanel boostedUntil={until} />));
      expect(t, String(until)).not.toMatch(TOP);
      expect(t, String(until)).toContain("Promoted strip");
    }
  });

  it("the panel's source has no top-of-search promise in any string (comments excluded)", () => {
    expect(code("src/app/(app)/talent-directory/verify/boost-panel.tsx")).not.toMatch(TOP);
  });
});

describe("the disclosure sentence: a seeker is told the Promoted label appears on their entry (V5 label disclosure)", () => {
  const SENTENCE = 'While a boost is active, your entry in employer search shows a "Promoted" label whenever it appears in the strip.';

  it("the panel carries exactly this sentence, once, in the idle, active and expired states", async () => {
    const { BoostPanel } = await import("@/app/(app)/talent-directory/verify/boost-panel");
    for (const until of [null, "2099-01-01T00:00:00Z", "2020-01-01T00:00:00Z"]) {
      const t = plain(renderToStaticMarkup(<BoostPanel boostedUntil={until} />));
      expect(t, String(until)).toContain(SENTENCE);
      expect(t.split(SENTENCE), String(until)).toHaveLength(2);
    }
  });

  it("it sits between the rotation sentence and the stacking sentence, so the paragraph is four sentences (one added, none changed)", async () => {
    const { boostPanelIntro } = await import("@/lib/talent-directory/boost-copy");
    const intro = boostPanelIntro(10);
    expect(intro).toBe(
      "A boost gives you a rotating seat in the Promoted strip on employer search for 7 days — 10 credits. " +
        "The strip shows up to 3 boosted candidates at a time and rotates every hour, so a seat is not a fixed position. " +
        SENTENCE +
        " Purchases stack: buying again while already boosted adds 7 more days to your current boost.",
    );
    expect(intro.split(/(?<=\.) /)).toHaveLength(4);
  });

  it("the word in it is the label's own constant (one source), and it is exported as its own constant for the panel", async () => {
    const { BOOST_LABEL_DISCLOSURE } = await import("@/lib/talent-directory/boost-copy");
    const { PROMOTED_LABEL } = await import("@/lib/talent-directory/promoted-label");
    expect(BOOST_LABEL_DISCLOSURE).toBe(SENTENCE);
    expect(BOOST_LABEL_DISCLOSURE).toContain(`"${PROMOTED_LABEL}"`);
  });

  it("it is honest about where and when: the search entry (not the profile page), and only while the entry is in the strip; no promise of a position", async () => {
    const { BOOST_LABEL_DISCLOSURE } = await import("@/lib/talent-directory/boost-copy");
    expect(BOOST_LABEL_DISCLOSURE).toMatch(/\bwhile a boost is active\b/i);
    expect(BOOST_LABEL_DISCLOSURE).toMatch(/\bwhenever it appears in the strip\b/);
    expect(BOOST_LABEL_DISCLOSURE).toMatch(/\bemployer search\b/);
    expect(BOOST_LABEL_DISCLOSURE).not.toMatch(/\bprofile\b/i);
    expect(BOOST_LABEL_DISCLOSURE).not.toMatch(/\balways\b|\bevery (time|search)\b|\bguarantee/i);
    expect(BOOST_LABEL_DISCLOSURE).not.toMatch(TOP);
  });

  it("the purchase message is unchanged (the disclosure is one sentence, in one place)", async () => {
    const { boostPurchasedMessage } = await import("@/lib/talent-directory/boost-copy");
    expect(boostPurchasedMessage("6 Nov 2026")).toBe("Boost added: a rotating seat in the Promoted strip for 7 days, now until 6 Nov 2026.");
    expect(boostPurchasedMessage("6 Nov 2026")).not.toContain("label");
  });
});

describe("the message after a purchase", () => {
  it("is exactly: Boost added: a rotating seat in the Promoted strip for 7 days, now until <date>.", async () => {
    const { boostPurchasedMessage } = await import("@/lib/talent-directory/boost-copy");
    expect(boostPurchasedMessage("6 Nov 2026")).toBe("Boost added: a rotating seat in the Promoted strip for 7 days, now until 6 Nov 2026.");
    expect(boostPurchasedMessage("6 Nov 2026")).not.toMatch(TOP);
  });

  it("the runner returns that message and its source has no top-of-search promise in any string (comments excluded)", () => {
    const src = code("src/lib/talent-directory/boost-runner.ts");
    expect(src).toContain("boostPurchasedMessage(");
    expect(src).not.toMatch(TOP);
  });

  it("the old promises are gone from every seeker-facing file under src (the two developer comments about 'top-of-search' are not copy and are listed here so they are not mistaken for it)", () => {
    const COPY_FILES = ["src/lib/talent-directory/boost-runner.ts", "src/app/(app)/talent-directory/verify/boost-panel.tsx", "src/app/(app)/talent-directory/verify/page.tsx", "src/lib/talent-directory/boost-copy.ts"];
    for (const f of COPY_FILES) expect(code(f), f).not.toMatch(/to the top of|top of (employer )?search|on top of your/i);
  });
});

describe("what the copy says about the strip is what the migration does", () => {
  const sql = read("supabase/migrations/0268_talent_directory_promoted_strip.sql").replace(/\s+/g, " ");

  it("the strip holds at most three candidates (the helper's cap defaults to 3 and is clamped to 3)", async () => {
    const { PROMOTED_STRIP_SEATS } = await import("@/lib/talent-directory/boost-copy");
    expect(PROMOTED_STRIP_SEATS).toBe(3);
    expect(sql).toMatch(/p_cap integer default 3/);
    expect(sql).toContain("least(greatest(coalesce(p_cap, 3), 0), 3)");
  });

  it("the rotation moves every hour (the bucket the search passes is the epoch divided by 3600 seconds)", () => {
    expect(sql).toContain("floor(extract(epoch from now()) / 3600)");
  });
});
