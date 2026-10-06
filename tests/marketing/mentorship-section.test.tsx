/**
 * The homepage "Real human mentors" section (owner request, 6 Oct 2026; reports/S1 mentor-section report).
 *
 * The goal: a first-time visitor sees what they get BEFORE any money, and the section does not contradict "Get started for free". The owner's seven hard rules, each pinned here:
 *   1. no price, currency symbol or amount anywhere in the section;
 *   2. no session length;
 *   3. no individual mentor name, photo or company, and nothing about a mentor reaches the section (it takes no props and reads no data);
 *   4. "never through credits" is gone;
 *   5. only session types the product actually offers (checked against the booking page's list, below);
 *   6. both links point where the spec says;
 *   7. (click events: NOT in this PR; see the guard at the end.)
 * It also pins the accessibility basics: the contrast of the colours it uses, hit targets on both links, and heading order.
 *
 * Runs with no database and no browser: the section is a plain server component, rendered to static markup. The old version of this file queried the live price floor, which this section no longer shows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { MentorshipSection } from "@/components/marketing/mentorship-section";
import { contrast } from "../support/contrast";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");
// Rendered once, in beforeAll, so a section that cannot render fails each test on its own assertion (and the test also works on an async component, which the rules below then reject).
let html = "";
let text = "";
beforeAll(async () => {
  html = renderToStaticMarkup((await Promise.resolve((MentorshipSection as () => unknown)())) as never);
  text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
});
const source = read("src/components/marketing/mentorship-section.tsx");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the copy the owner approved", () => {
  it.each([
    "Real human mentors",
    "Some moments deserve a real person.",
    "Negotiating an offer or preparing for a final round goes better with someone who has done the job. Talk it through 1:1 with an experienced mentor.",
    "Every mentor is reviewed by our team before they can take bookings.",
    "Farah is free to start. Mentors are optional — pay per session, no subscription.",
    "1:1 mentor sessions",
    "You'll see each mentor's session lengths before you book.",
    "Browse mentors",
    "Experienced professional? Become a mentor",
  ])("says: %s", (line) => {
    expect(text).toContain(line);
  });

  it("lists the four session types, each with its one line", () => {
    for (const [label, line] of [
      ["Mock interview", "Practise the real thing before it counts."],
      ["Offer negotiation", "Prepare for a specific offer."],
      ["Career strategy", "Talk through your next move."],
      ["Resume review", "A second opinion from someone who's hired."],
    ]) {
      expect(text).toContain(label);
      expect(text).toContain(line);
    }
  });

  it("is the old section replaced, not added to: the old claims are gone (rule 4)", () => {
    expect(text).not.toMatch(/never through credits/i);
    expect(text).not.toMatch(/never a\s+surprise on price/i);
    expect(text).not.toMatch(/Find a mentor/);
    expect(text).not.toMatch(/Sessions from|set their own rates/i);
  });
});

describe("hard rule 1: no price, currency or amount", () => {
  it("shows no currency symbol or code, and no digit other than the '1:1' of one-to-one", () => {
    expect(text).not.toMatch(/[₦$£€¥]|\b(NGN|USD|GBP|EUR|naira|dollars?|pounds?)\b/i);
    expect(text.replace(/1:1/g, "")).not.toMatch(/\d/);
  });
  it("does not use the money components or read a price", () => {
    expect(code).not.toMatch(/NairaAmount|getApprovedMentorPriceRangeNgn|priceRange|public-price-range|price_ngn|CREDIT_COSTS|credits?\b/i);
  });
  it("says no price word either: the price lives on /mentorship and the booking pages", () => {
    expect(text).not.toMatch(/\b(price|prices|priced|cost|costs|fee|fees|rates?)\b/i);
  });
});

describe("hard rule 2: no session length", () => {
  it("states no duration (no number of minutes or hours, no 'quick' session)", () => {
    expect(text).not.toMatch(/\b\d+\s*(min|mins|minutes?|hours?|hrs?)\b/i);
    expect(text).not.toMatch(/\b(half[- ]hour|hour[- ]long|quick (question|chat))\b/i);
  });
  it("only points to where the lengths are shown, in the approved sentence", () => {
    expect(text).toContain("You'll see each mentor's session lengths before you book.");
  });
});

describe("hard rule 3: no mentor identity, and none can reach the section", () => {
  it("takes no props and is not async, so no data can be passed to it or awaited in it", () => {
    expect(MentorshipSection.length).toBe(0);
    expect(source).not.toMatch(/export\s+async\s+function\s+MentorshipSection/);
    const result = (MentorshipSection as () => unknown)();
    expect(typeof (result as { then?: unknown })?.then).toBe("undefined");
  });
  it("imports no database, auth, supabase, service-role or mentorship query module", () => {
    const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) expect(spec, `unexpected import ${spec}`).not.toMatch(/supabase|service-role|mentorship\/(queries|public-price-range|actions)|\/auth\/|server-only/);
  });
  it("renders no image, avatar or initials badge", () => {
    expect(html).not.toMatch(/<img|<picture|<svg[^>]*role="img"|avatar/i);
  });
  it("the homepage passes it nothing", () => {
    expect(read("src/app/page.tsx")).toMatch(/<MentorshipSection\s*\/>/);
  });
  it("names no person, company or stat (no 'N mentors', no 'N sessions', no rating)", () => {
    expect(text).not.toMatch(/\d+\s*(sessions?|mentors?|reviews?)\b/i);
    expect(text).not.toMatch(/\d+(\.\d+)?\s*(%|\/\s*5|stars?)/i);
  });
});

describe("hard rule 5: only session types the product offers", () => {
  const offered = read("src/app/(app)/mentorship/[mentorId]/page.tsx");
  it("the booking page offers resume review, mock interview, career strategy and negotiation strategy for a specific offer", () => {
    for (const value of ["resume_review", "mock_interview", "career_strategy", "negotiation_strategy"]) expect(offered).toContain(`value: "${value}"`);
  });
  it("lists exactly four types, none of them the booking page's fifth (the quick question)", () => {
    expect((html.match(/<li[^>]*data-session-type/g) ?? []).length).toBe(4);
    expect(text).not.toMatch(/quick question/i);
  });
});

describe("hard rule 6: the two links", () => {
  const links = () => [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], label: m[2].replace(/<[^>]+>/g, "").trim() }));
  it("'Browse mentors' goes to /mentorship", () => {
    expect(links().find((l) => l.label === "Browse mentors")?.href).toBe("/mentorship");
  });
  it("'Experienced professional? Become a mentor →' goes to /mentorship/apply", () => {
    expect(links().find((l) => /^Experienced professional\? Become a mentor/.test(l.label))?.href).toBe("/mentorship/apply");
  });
  it("has exactly those two links", () => {
    expect(links().length).toBe(2);
  });
});

describe("accessibility", () => {
  it("heading order: one h2 for the section and nothing else that is a heading", () => {
    expect((html.match(/<h2[\s>]/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<h[13-6][\s>]/);
  });
  it("the section is labelled by its heading", () => {
    expect(html).toMatch(/<section[^>]*aria-labelledby="mentors-heading"/);
    expect(html).toMatch(/<h2[^>]*id="mentors-heading"/);
  });
  it("both links have a real hit target of at least 44px (min-h-11)", () => {
    for (const m of html.matchAll(/<a\s[^>]*class="([^"]*)"[^>]*>/g)) expect(m[1], m[0]).toMatch(/\bmin-h-11\b/);
  });
  it("the check marks are decorative: hidden from a screen reader, and drawn as inline SVG, not an emoji", () => {
    expect((html.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length).toBe(2);
    expect(text).not.toMatch(/[✓✔☑✅]/);
  });
  it("the text colours it uses clear 4.5:1 on the paper and on the card (body ink-soft, eyebrow rust, headings ink)", () => {
    for (const fg of ["ink", "ink-soft", "rust"]) {
      for (const bg of ["paper", "card"]) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(html).toMatch(/text-ink-soft/);
    expect(html).not.toMatch(/text-\[oklch|text-gray|text-slate|(?:^|[\s"])opacity-\d/);
  });
  it("follows the Editorial system: a bordered card with no radius or shadow, and no rounded or shadow class anywhere", () => {
    expect(html).not.toMatch(/\brounded|\bshadow/);
  });
});

describe("rule 7 (click events) is NOT in this PR", () => {
  it("adds no analytics call and no consent gate: custom events are a separate decision (see the report)", () => {
    expect(code).not.toMatch(/@vercel\/analytics|\btrack\(|\bgtag\(|\bdataLayer\b|onClick/);
  });
});
