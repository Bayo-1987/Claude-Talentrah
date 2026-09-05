/**
 * The sitemap's scholarship section: verified listings in, pending ones out.
 *
 * sitemap.ts's own rule is "only URLs a signed-out visitor actually receives
 * a 200 for" — the same rule the jobs section already lives by. This is the
 * scholarship-side check of that rule, and the pending case is a real
 * fixture rather than an assumption: a pending row is inserted here, its id
 * is asserted absent from the rendered sitemap, and it is removed
 * afterwards regardless of whether the assertion passed.
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";

// Resolved by natural key, not a hardcoded id (Stage 2) — a literal id was
// only ever stable because the old shared CI database was never wiped; a
// fresh per-run local Supabase stack generates a new one every run.
let VERIFIED_SCHOLARSHIP: string;

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("scholarships")
    .select("id")
    .eq("program_name", "Gates Cambridge Scholarship")
    .eq("moderation_status", "verified")
    .single();
  if (error || !data) {
    throw new Error(`seeded "Gates Cambridge Scholarship" not found — run \`npm run seed:catalog\`: ${error?.message ?? "no row"}`);
  }
  VERIFIED_SCHOLARSHIP = data.id;
});

test.describe("scholarship sitemap coverage", () => {
  test("a verified listing appears, with the /scholarships/ path", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body, "the known verified scholarship is missing from the sitemap").toContain(
      `/scholarships/${VERIFIED_SCHOLARSHIP}`,
    );
  });

  test("a pending listing never appears", async ({ request }) => {
    const tag = randomUUID().slice(0, 8);
    const { data, error } = await admin
      .from("scholarships")
      .insert({
        provider: `SITEMAP-TEST Provider ${tag}`,
        program_name: `SITEMAP-TEST ${tag}`,
        degree_levels: ["msc"],
        field_tags: [],
        funding_type: "full",
        funding_covers: [],
        eligibility_nationalities: ["Nigeria"],
        official_url: "https://example.test/sitemap-fixture",
        dedup_fingerprint: `sitemap-test-${tag}`,
        moderation_status: "pending",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`could not create fixture: ${error?.message}`);

    try {
      const res = await request.get("/sitemap.xml");
      const body = await res.text();

      /*
       * POSITIVE CONTROL FIRST, because the assertion below is an absence.
       *
       * `not.toContain` passes against an empty string, a 404 page and a
       * 500 — every way the sitemap can be broken is also a way this test
       * can report success. It has to be shown that the sitemap loaded and
       * is really listing scholarships before "this id is not in it" means
       * anything at all.
       */
      expect(res.status(), "the sitemap did not load, so the check below proves nothing").toBe(200);
      expect(
        body,
        "the sitemap returned no scholarship URLs, so an absent id proves nothing",
      ).toContain("/scholarships/");

      expect(body, "a pending scholarship leaked into the public sitemap").not.toContain(data.id);
    } finally {
      // afterEach-style cleanup inline, so it runs whether the assertion
      // above passed or threw — a fixture left behind here would poison
      // this test's own next run, since dedup_fingerprint is not reused.
      const { error: delErr } = await admin.from("scholarships").delete().eq("id", data.id);
      if (delErr) throw new Error(`sitemap fixture cleanup failed: ${delErr.message}`);
    }
  });
});
