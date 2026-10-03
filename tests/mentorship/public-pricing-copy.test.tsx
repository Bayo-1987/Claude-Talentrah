/**
 * The /mentorship pricing copy (S1-26 item 8): no "₦20,000 to ₦20,000", and no free-mentor claim that isn't true.
 *
 * Owner report, live on talentrah.com/mentorship: with one approved mentor the Pricing section read "sessions currently range from
 * ₦20,000 to ₦20,000". Rendered here without a database: the page hands the component the range and whether any approved mentor
 * offers free or volunteer sessions, so every case is a plain prop.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MentorshipPublicLanding } from "@/components/mentorship/public-landing";
import { mentorshipPriceClause } from "@/lib/mentorship/price-copy";

vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => <a href={p.href}>{p.children as never}</a> }));

const text = (props: Parameters<typeof MentorshipPublicLanding>[0]) =>
  renderToStaticMarkup(<MentorshipPublicLanding {...props} />).replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'");

/** The one sentence that states the price, as rendered: "Right now, ... ." */
const priceSentence = (t: string) => t.match(/Right now,[^.]*\./)?.[0];

describe("the Pricing paragraph", () => {
  it("one priced mentor (min equals max): 'a session costs ₦20,000', the noun once, never 'from X to X'", () => {
    const t = text({ priceRangeNgn: { minNgn: 20000, maxNgn: 20000 }, offersFreeSessions: false });
    expect(priceSentence(t)).toBe("Right now, a session costs ₦20,000.");
    expect(t).not.toMatch(/₦20,000 to ₦20,000/);
    expect(t).not.toMatch(/range from/);
    expect(t.match(/₦20,000/g)).toHaveLength(1);
  });

  it("different prices: 'sessions cost from ₦X to ₦Y', the noun once", () => {
    const t = text({ priceRangeNgn: { minNgn: 15000, maxNgn: 20000 }, offersFreeSessions: false });
    expect(priceSentence(t)).toBe("Right now, sessions cost from ₦15,000 to ₦20,000.");
  });

  it.each([
    [{ minNgn: 20000, maxNgn: 20000 }],
    [{ minNgn: 15000, maxNgn: 20000 }],
  ])("the whole price sentence names 'session' no more than once (%j)", (priceRangeNgn) => {
    const sentence = priceSentence(text({ priceRangeNgn, offersFreeSessions: false }))!;
    expect(sentence.match(/session/gi), sentence).toHaveLength(1);
  });

  it("no priced mentors: the price sentence is left out entirely, and the rest of the paragraph stays", () => {
    const t = text({ priceRangeNgn: null, offersFreeSessions: false });
    expect(t).not.toMatch(/₦\d/);
    expect(priceSentence(t)).toBeUndefined();
    expect(t).toContain("Mentors set their own rates depending on their experience and the kind of session.");
    expect(t).toContain("You pay the mentor directly");
  });
});

describe("the free-mentor sentence", () => {
  it("is stated as fact only when at least one approved mentor offers free or volunteer sessions", () => {
    const t = text({ priceRangeNgn: { minNgn: 20000, maxNgn: 20000 }, offersFreeSessions: true });
    expect(t).toContain("Some mentors offer sessions for free or as volunteers");
    expect(t).not.toContain("Mentors can choose to offer sessions for free");
  });

  it("otherwise states the policy without implying it is happening now", () => {
    const t = text({ priceRangeNgn: { minNgn: 20000, maxNgn: 20000 }, offersFreeSessions: false });
    expect(t).toContain(
      "Mentors can choose to offer sessions for free; if one does, that's shown on their profile before you book, never a surprise afterward.",
    );
    expect(t).not.toContain("Some mentors offer");
    expect(t).not.toContain("as volunteers");
  });
});

describe("the metadata price clause", () => {
  it("one amount, a range, or nothing", () => {
    expect(mentorshipPriceClause({ minNgn: 20000, maxNgn: 20000 })).toBe(", ₦20,000 per session");
    expect(mentorshipPriceClause({ minNgn: 15000, maxNgn: 20000 })).toBe(", from ₦15,000 to ₦20,000 per session");
    for (const r of [{ minNgn: 20000, maxNgn: 20000 }, { minNgn: 15000, maxNgn: 20000 }]) {
      expect(mentorshipPriceClause(r).match(/session/g)).toHaveLength(1);
    }
    expect(mentorshipPriceClause(null)).toBe("");
  });
});
