/**
 * send-389 — confirms the new MentorshipSection lands in the right place in
 * the homepage's own section list and that nothing else in that list moved.
 * A source-level check on `src/app/page.tsx`'s own JSX order, not a full
 * render: `Home` composes GoogleOneTap/MarketingStickyCta, both client
 * components that read auth state in the browser after mount, so a real
 * render tells you nothing about section ORDER that reading the source
 * doesn't already tell you more reliably.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf-8");

const EXPECTED_ORDER = [
  "MarketingMasthead",
  "GoogleOneTap",
  "HeroSection",
  "JobBoardPreview",
  "ProblemSection",
  "HowItWorksSection",
  "MeetFarahSection",
  "MentorshipSection",
  "FaqSection",
  "FinalCtaSection",
  "MarketingFooter",
  "MarketingStickyCta",
];

describe("the homepage's own section order", () => {
  it("renders every section in the expected order, with MentorshipSection between Meet Farah and the FAQ", () => {
    const positions = EXPECTED_ORDER.map((name) => {
      const index = source.indexOf(`<${name} `);
      const selfClosing = source.indexOf(`<${name}/>`);
      const selfClosingSpaced = source.indexOf(`<${name} />`);
      return Math.max(index, selfClosing, selfClosingSpaced);
    });
    for (const [i, name] of EXPECTED_ORDER.entries()) {
      expect(positions[i], `${name} was not found rendered in page.tsx`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(
        positions[i],
        `${EXPECTED_ORDER[i]} did not come after ${EXPECTED_ORDER[i - 1]}`,
      ).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("does not introduce a new server-side auth/session read — no new supabase/auth import", () => {
    // page.tsx's own header explains why: reading the auth cookie in a
    // Server Component here opts the WHOLE route into dynamic rendering.
    // MentorshipSection must not be the thing that reintroduces that. Block
    // comments are stripped first — the file's own header comment mentions
    // `supabase.auth.getUser()` BY NAME, in past tense, explaining why that
    // call was already removed; matching the comment itself would be
    // checking the wrong thing.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/supabase\.auth\.getUser|createClient\(\).*auth/i);
  });
});
