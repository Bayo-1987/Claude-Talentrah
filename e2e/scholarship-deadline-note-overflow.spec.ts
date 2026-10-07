/**
 * QA-3 — a long unbroken token in a scholarship's deadline note wraps at a phone width instead of scrolling the page sideways.
 *
 * QA's 360px sweep of the public sitemap found /scholarships/fully-funded (403px wide), /scholarships/degree/bsc (403) and one scholarship detail page (396), all from one
 * listing whose verified deadline note carries a long URL-like path. This seeds that shape (an invented path, no spaces or hyphens to break at) on a verified scholarship
 * with no date, then measures document scrollWidth at 360 on the detail page and, where the database lets the fixtures isolate it, on the degree landing page.
 *
 * The detail page has no minimum-entries gate, so that assertion always runs. A degree landing page answers 200 only with LANDING_PAGE_MIN_ENTRIES (5) open scholarships at the
 * level (src/lib/seo/landing-pages.ts), so the landing assertion tops the level with fewest ambient rows up to exactly 5 and SKIPS when every level already has 5 (the ambient
 * rows' own order then decides whether the fixture is on the page, which this spec does not control). The deterministic red/green for the class itself is
 * tests/scholarships/deadline-note-wraps.test.tsx.
 *
 * NOT run locally (no database on the authoring machine): this spec's first run is its CI run.
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";

const THRESHOLD = 5; // LANDING_PAGE_MIN_ENTRIES
const LEVELS = [
  ["bsc", "bsc"],
  ["msc", "msc"],
  ["phd", "phd"],
  ["postgraduate_diploma", "postgraduate-diploma"],
  ["other", "other"],
] as const;
const PHONE = { width: 360, height: 800 };
const LONG_NOTE =
  "Provider calendar (example.test/admission/apply/firstyear/calendar_deadlines_for_the_fall_twenty_twenty_seven_enrollment_cycle_overview), deadlines vary by partner.";

const created: string[] = [];
test.afterEach(async () => {
  if (!created.length) return;
  const ids = created.splice(0);
  const { error } = await admin.from("scholarships").delete().in("id", ids);
  if (error) throw new Error(`scholarship fixture cleanup failed: ${error.message}`);
});

async function ambientOpen(level: string): Promise<number> {
  const { data, error } = await admin.rpc("scholarship_landing_facet_counts_at", { p_now: new Date().toISOString() }).single();
  if (error || !data) throw new Error(`facet counts: ${error?.message}`);
  const row = data as Record<string, number>;
  return { bsc: row.bsc_count, msc: row.msc_count, phd: row.phd_count, postgraduate_diploma: row.postgraduate_diploma_count, other: row.other_count }[level]!;
}

const scrollWidth = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth);

test("the detail page and the degree landing page do not scroll sideways at 360px with a long deadline note", async ({ page }) => {
  test.setTimeout(180_000);
  const counts = await Promise.all(LEVELS.map(async ([level, slug]) => ({ level, slug, n: await ambientOpen(level) })));
  const target = counts.sort((a, b) => a.n - b.n)[0];
  const isolated = target.n < THRESHOLD;

  const rowFor = (i: number, note: boolean) => ({
    provider: "E2E deadline-note overflow",
    program_name: `E2E deadline-note overflow ${i} ${randomUUID().slice(0, 6)}`,
    funding_type: "full" as const,
    degree_levels: [target.level as never],
    official_url: "https://example.test/deadline-note-overflow",
    dedup_fingerprint: `e2e-deadline-note-overflow-${randomUUID()}`,
    moderation_status: "verified" as const,
    application_deadline: null,
    ...(note ? { deadline_note: LONG_NOTE, deadline_verified_at: new Date().toISOString() } : {}),
  });

  // One row carries the note; when the level can be isolated, plain rows make the total exactly THRESHOLD so the landing page answers 200 and lists all of them.
  const need = isolated ? Math.max(THRESHOLD - target.n, 1) : 1;
  const { data: inserted, error } = await admin
    .from("scholarships")
    .insert(Array.from({ length: need }, (_, i) => rowFor(i, i === 0)))
    .select("id, deadline_note");
  if (error || !inserted) throw new Error(`fixtures: ${error?.message}`);
  created.push(...inserted.map((r) => r.id));
  const noted = inserted.find((r) => r.deadline_note);
  expect(noted, "the fixture with the long note was inserted").toBeTruthy();

  await page.setViewportSize(PHONE);

  await page.goto(`/scholarships/${noted!.id}`);
  await expect(page.getByText("calendar_deadlines_for_the_fall", { exact: false }), "the note renders on the detail page").toBeVisible();
  expect(await scrollWidth(page), "detail page scrollWidth").toBeLessThanOrEqual(PHONE.width);

  test.skip(!isolated, `every degree level already has ${THRESHOLD}+ open scholarships, so the landing page cannot be isolated to include the fixture`);
  const landing = `/scholarships/degree/${target.slug}`;
  const res = await page.goto(landing);
  expect(res?.status(), `${landing} answers 200 with exactly ${THRESHOLD} open`).toBe(200);
  await expect(page.getByText("calendar_deadlines_for_the_fall", { exact: false })).toBeVisible();
  expect(await scrollWidth(page), `${landing} scrollWidth`).toBeLessThanOrEqual(PHONE.width);
});
