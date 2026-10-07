/**
 * The feed test in e2e/apply-requires-resume.spec.ts checks EVERY internal card, in ONE browser call. It used to loop the cards with three awaited reads each, so its
 * time was (cards on the feed) x (round trips). The default /jobs tab renders the whole scored board (up to RECOMMENDED_HARD_CAP, 2000), and the CI database holds whatever the
 * live external job boards returned when `npm run seed` ran its real ingestion, so the loop took 3-5 s in most runs and ~32 s (a failure at the 30 s default) in others.
 * This pins the shape that does not grow with the board: one evaluateAll, no per-card await loop, no N bound, the count recorded, and the timeout held at 60 s until ten green runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const spec = readFileSync(path.join(__dirname, "../../e2e/apply-requires-resume.spec.ts"), "utf8");
const FEED_TEST_START = spec.indexOf("feed: every internal card offers");
const feedTest = spec.slice(FEED_TEST_START, spec.indexOf("job detail page, no screening questions", FEED_TEST_START));

describe("the feed test in apply-requires-resume.spec.ts", () => {
  it("finds the feed test (the checks below are not empty)", () => {
    expect(FEED_TEST_START).toBeGreaterThan(-1);
    expect(feedTest.length).toBeGreaterThan(200);
  });
  it("checks every card in ONE browser call (evaluateAll), polled so a late render is retried", () => {
    expect(feedTest).toContain("evaluateAll");
    expect(feedTest).toContain("expect.poll");
  });
  it("has no per-card await loop and no bound on how many cards it looks at", () => {
    expect(feedTest).not.toMatch(/for \((let|const) [a-z]+ = 0; [a-z]+ < /);
    expect(feedTest).not.toContain("cards.nth(");
    expect(feedTest).not.toMatch(/(els|cards|all)\.slice\(|\.first\(\d|MAX_CARDS|els\.splice/);
  });
  it("keeps the guarantee: no internal card without the 'Add a resume to apply' link, none with a bare Apply, at least one internal card", () => {
    expect(feedTest).toContain("Add a resume to apply");
    expect(feedTest).toMatch(/"Apply"/);
    expect(feedTest).toContain("sourced externally");
    expect(feedTest).toMatch(/internalCount|internal cards?/);
    expect(feedTest).toContain("toBeGreaterThan(0)");
  });
  it("records how many cards it saw as a test annotation, so the next run says what the board was", () => {
    expect(feedTest).toMatch(/annotations\.push\(/);
  });
  it("holds the timeout at 60 s (not the 30 s default yet, not the 90 s stopgap): back to the default after ten green runs on main", () => {
    expect(feedTest).toContain("test.setTimeout(60_000)");
    expect(feedTest).not.toContain("90_000");
  });
});
