/**
 * send-508 / S3-21a — the landing pages move at the closing INSTANT, and the sitemap agrees with the page.
 *
 * A scholarship landing page answers 200 only while its live count of OPEN scholarships clears LANDING_PAGE_MIN_ENTRIES (5), and 404s below it
 * (src/lib/seo/landing-pages.ts). "Open" is now decided at the closing instant, so a boundary shift can flip a page between 200 and 404. This
 * puts exactly 5 open scholarships at one degree level, then closes ONE of them by instant only (a deadline of TODAY with a closing time two
 * minutes ago: still open under the old date rule, closed under the new one) and checks the page and the sitemap both drop it, then reopens it
 * and checks both return. Ambient rows are counted first so the total is exactly 5, not "some number above it".
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

test("a landing page goes from 200 to 404 when one of exactly five open scholarships closes BY INSTANT, and back", async ({ request }) => {
  test.setTimeout(180_000);
  // The level with the fewest ambient open scholarships, so the fixtures can make the total exactly THRESHOLD.
  const counts = await Promise.all(LEVELS.map(async ([level, slug]) => ({ level, slug, n: await ambientOpen(level) })));
  const target = counts.sort((a, b) => a.n - b.n)[0];
  test.skip(target.n >= THRESHOLD, `every degree level already has ${THRESHOLD}+ open scholarships in this database, so the boundary cannot be isolated`);

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const rowFor = (i: number, deadline: string, time: string, tz: string) => ({
    provider: "E2E close-instant",
    program_name: `E2E close-instant ${i} ${randomUUID().slice(0, 6)}`,
    funding_type: "full" as const,
    degree_levels: [target.level as never],
    official_url: "https://example.test/close-instant",
    dedup_fingerprint: `e2e-close-instant-${randomUUID()}`,
    moderation_status: "verified" as const,
    application_deadline: deadline,
    close_time: time,
    close_tz: tz,
  });

  const need = THRESHOLD - target.n;
  const { data: inserted, error } = await admin
    .from("scholarships")
    .insert(Array.from({ length: need }, (_, i) => rowFor(i, tomorrow, "23:00", "America/Toronto")))
    .select("id");
  if (error || !inserted) throw new Error(`fixtures: ${error?.message}`);
  created.push(...inserted.map((r) => r.id));
  expect(await ambientOpen(target.level), "precondition: exactly THRESHOLD open").toBe(THRESHOLD);

  const pagePath = `/scholarships/degree/${target.slug}`;
  const sitemapHas = async () => (await (await request.get("/sitemap.xml")).text()).includes(pagePath);

  expect((await request.get(pagePath)).status(), "5 open: the page renders").toBe(200);
  expect(await sitemapHas(), "5 open: the sitemap lists it").toBe(true);

  // Close ONE by instant only: today's date (still open under the old date rule) with a closing time two minutes ago.
  const twoMinAgo = new Date(Date.now() - 2 * 60_000);
  const { error: closeError } = await admin
    .from("scholarships")
    .update({ application_deadline: twoMinAgo.toISOString().slice(0, 10), close_time: twoMinAgo.toISOString().slice(11, 16), close_tz: "UTC" })
    .eq("id", inserted[0].id);
  if (closeError) throw new Error(`closing a fixture: ${closeError.message}`);
  expect(await ambientOpen(target.level), "one closed by instant: four open").toBe(THRESHOLD - 1);

  expect((await request.get(pagePath)).status(), "4 open: the page 404s").toBe(404);
  expect(await sitemapHas(), "4 open: the sitemap drops it, the same run").toBe(false);

  // Reopen it (closing time ten minutes ahead, in UTC).
  const tenMinAhead = new Date(Date.now() + 10 * 60_000);
  const { error: reopenError } = await admin
    .from("scholarships")
    .update({ application_deadline: tenMinAhead.toISOString().slice(0, 10), close_time: tenMinAhead.toISOString().slice(11, 16), close_tz: "UTC" })
    .eq("id", inserted[0].id);
  if (reopenError) throw new Error(`reopening a fixture: ${reopenError.message}`);
  expect((await request.get(pagePath)).status(), "5 open again: the page renders").toBe(200);
  expect(await sitemapHas(), "5 open again: the sitemap lists it").toBe(true);
});
