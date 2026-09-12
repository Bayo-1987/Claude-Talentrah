import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { runCleanups } from "../tests/support/teardown";
import { deletePostingsCascade, deleteOrgsCascade } from "../tests/support/delete-orgs";

/**
 * send-186: the three programmatic SEO landing pages — /jobs/in/[city],
 * /jobs/remote and /jobs/remote/[country] — pitched "Create a free account"
 * unconditionally, even to a visitor whose session cookie was right there in
 * the request. None of the three ever read the session at all before this.
 *
 * Fixtures, not ambient data: this repo's own landing-page-links.test.ts has
 * shown the live /jobs/remote and /jobs/in/lagos counts dip to 4 against
 * LANDING_PAGE_MIN_ENTRIES's threshold of 5, so relying on whatever is
 * already in the shared dev database would make this flaky for a reason
 * that has nothing to do with the bug it exists to catch. A `location` of
 * "Lagos, Nigeria" with `work_type: "remote"` clears all three pages'
 * filters at once (city: `location ilike %lagos%`; remote:
 * `work_type = remote`; country: `work_type = remote` + "Nigeria" literally
 * in `location`) — one fixture batch per test, three pages, comfortably
 * above threshold regardless of ambient drift.
 *
 * Not the full landing-auth-variant.spec.ts two-state proof (that page
 * resolves auth client-side and needed both states pinned against a
 * pre-rendered shell); these pages are server-rendered per request already,
 * so one signed-in assertion per page plus one signed-out control is enough
 * to prove the branch is real and wired to the right template.
 *
 * The signed-in destination is asserted PER PAGE, not just the shared button
 * copy: /jobs already understands `?workType=` and `?country=` (see its own
 * searchParams handling), so /jobs/remote and /jobs/remote/[country] carry
 * that filter through instead of dropping a returning visitor on a generic
 * /jobs they'd have to re-filter by hand. /jobs/in/[city] has no matching
 * city filter on /jobs to hand off to, so plain /jobs is the honest
 * destination there — asserted too, so a future change can't silently start
 * inventing one.
 */

const FIXTURE_COUNT = 6; // comfortably above LANDING_PAGE_MIN_ENTRIES (5) alone

test.describe("SEO landing pages don't pitch a signed-in visitor the account they already have", () => {
  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];

  test.afterEach(async () => {
    await runCleanups(
      [
        "signed-in CTA fixture postings",
        async () => {
          if (createdJobIds.length) await deletePostingsCascade(admin, createdJobIds.splice(0));
        },
      ],
      [
        "signed-in CTA fixture organisations",
        async () => {
          if (createdOrgIds.length) await deleteOrgsCascade(admin, createdOrgIds.splice(0));
        },
      ],
    );
  });

  /** Clears the city, remote and country-remote filters in one batch — see the header above. */
  async function seedLagosRemoteJobs(ownerId: string): Promise<void> {
    const { data: org, error } = await admin
      .from("organizations")
      .insert({
        name: `E2E SEO Signed-In CTA Co ${randomUUID().slice(0, 8)}`,
        created_by: ownerId,
        verified: true,
      })
      .select("id")
      .single();
    if (error || !org) throw new Error(`fixture org: ${error?.message}`);
    createdOrgIds.push(org.id);

    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const { data: job, error: jobError } = await admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: org.id,
          company_name: "E2E SEO Signed-In CTA Co",
          title: `Fixture role ${i} for the signed-in CTA test`,
          description: "A real fixture posting long enough to render on a card in the e2e suite.",
          status: "open",
          location: "Lagos, Nigeria",
          work_type: "remote",
          posted_at: new Date().toISOString(),
          dedup_fingerprint: `e2e-seo-signed-in-cta-${randomUUID()}`,
        })
        .select("id")
        .single();
      if (jobError || !job) throw new Error(`fixture posting: ${jobError?.message}`);
      createdJobIds.push(job.id);
    }
  }

  /*
   * The expected signed-in href, as it actually appears in rendered HTML —
   * React/Next escapes `&` in an attribute to `&amp;`, so the raw query
   * string with a literal `&` would never match a real response body.
   */
  const PAGES = [
    { path: "/jobs/in/lagos", label: "city", signedInHref: "/jobs" },
    { path: "/jobs/remote", label: "remote", signedInHref: "/jobs?workType=remote" },
    {
      path: "/jobs/remote/nigeria",
      label: "country",
      signedInHref: "/jobs?workType=remote&amp;country=Nigeria",
    },
  ] as const;

  for (const { path, label, signedInHref } of PAGES) {
    test(`${label} page (${path}): signed in sees the Jobs pointer, not the signup pitch`, async ({
      authedPage,
      testUser,
    }) => {
      await seedLagosRemoteJobs(testUser.id);

      const res = await authedPage.request.get(path);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body, `${path} still pitches signup to a signed-in visitor`).not.toContain(
        "Create a free account",
      );
      expect(body, `${path} is missing the signed-in Jobs pointer`).toContain(
        "Go to Jobs to see your match score",
      );
      expect(
        body,
        `${path}'s signed-in Jobs pointer doesn't carry this page's own filter through`,
      ).toContain(`href="${signedInHref}"`);
    });
  }

  for (const { path, label } of PAGES) {
    test(`${label} page (${path}): signed out still gets the signup pitch — proves the test would have caught the bug`, async ({
      request,
      testUser,
    }) => {
      // `testUser` here only owns the fixture org (organizations.created_by
      // is not null) — the actual HTTP call below goes through the plain,
      // unauthenticated `request` fixture, never `authedPage`.
      await seedLagosRemoteJobs(testUser.id);

      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body, `${path} lost its anonymous signup pitch`).toContain("Create a free account");
      expect(body, `${path} leaked the signed-in Jobs pointer to a signed-out visitor`).not.toContain(
        "Go to Jobs to see your match score",
      );
    });
  }
});
