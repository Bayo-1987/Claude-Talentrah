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
 * A LATER SEND found two more bugs in the same family, on these same three
 * pages plus two more:
 *
 *   1. The "← Talentrah home" breadcrumb above the CTA block was hardcoded
 *      to `/` on ALL FIVE pages (the two scholarship pages included),
 *      completely independent of the CTA fix above it — the founder hit
 *      this directly: signed in on /jobs/remote, the masthead wordmark
 *      above (correctly → /jobs) and this breadcrumb below it (→ /,
 *      always) disagreed, and he clicked the wrong one. Fixed to
 *      `session ? "/jobs" : "/"` on all five, matching the masthead
 *      wordmark it duplicates — NOT the page's own filtered CTA href below,
 *      which stays exactly as it was. The two links have different labels
 *      for a reason; the assertions below pin their hrefs SEPARATELY so a
 *      future change can't quietly collapse them into each other the way
 *      this bug already showed they can drift apart.
 *   2. /scholarships/fully-funded and /scholarships/degree/[level] never
 *      got send-186's own CTA fix at all — neither page imported
 *      getOptionalUser or computed a session, so both pitched "Create a
 *      free account" unconditionally, same bug, just never reached the
 *      first time. Fixed with the identical signed-in/signed-out split the
 *      three jobs pages already use, pointed at /scholarships instead of
 *      /jobs.
 *
 * Fixtures, not ambient data: this repo's own landing-page-links.test.ts has
 * shown the live /jobs/remote and /jobs/in/lagos counts dip to 4 against
 * LANDING_PAGE_MIN_ENTRIES's threshold of 5, so relying on whatever is
 * already in the shared dev database would make this flaky for a reason
 * that has nothing to do with the bug it exists to catch. A `location` of
 * "Lagos, Nigeria" with `work_type: "remote"` clears all three jobs pages'
 * filters at once (city: `location ilike %lagos%`; remote:
 * `work_type = remote`; country: `work_type = remote` + "Nigeria" literally
 * in `location`) — one fixture batch per test, three pages, comfortably
 * above threshold regardless of ambient drift. The two scholarship pages get
 * their own fixture batch below, same reasoning: `funding_type: "full"` +
 * `degree_levels: ["msc"]` clears both pages' filters at once.
 *
 * Not the full landing-auth-variant.spec.ts two-state proof (that page
 * resolves auth client-side and needed both states pinned against a
 * pre-rendered shell); these pages are server-rendered per request already,
 * so one signed-in assertion per page plus one signed-out control is enough
 * to prove the branch is real and wired to the right template.
 */

const FIXTURE_COUNT = 6; // comfortably above LANDING_PAGE_MIN_ENTRIES (5) alone

/**
 * The breadcrumb's own href, PAIRED with its own text in one substring —
 * not just "the page contains href=X somewhere". A bare `href="/jobs"`
 * check would pass even with a still-broken breadcrumb, because the
 * masthead wordmark rendered above these pages for a signed-in visitor
 * ALSO links to /jobs (src/components/app-shell/masthead.tsx) — confirmed
 * against real rendered output (curl against a local dev server) that Next
 * emits this as one contiguous `href="X">← Talentrah home</a>` with no
 * whitespace around the text, so pairing them into one string is both
 * correct and precise.
 */
function breadcrumbHtml(href: string): string {
  return `href="${href}">← Talentrah home</a>`;
}

test.describe("SEO landing pages don't pitch a signed-in visitor the account they already have", () => {
  const createdOrgIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdScholarshipIds: string[] = [];

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
      [
        "signed-in CTA fixture scholarships",
        async () => {
          if (!createdScholarshipIds.length) return;
          const ids = createdScholarshipIds.splice(0);
          const { error } = await admin.from("scholarships").delete().in("id", ids);
          if (error) throw new Error(`scholarship fixture cleanup failed: ${error.message}`);
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

  /** Clears both scholarship pages' filters at once — see the header above. */
  async function seedFullyFundedMscScholarships(): Promise<void> {
    for (let i = 0; i < FIXTURE_COUNT; i++) {
      const { data, error } = await admin
        .from("scholarships")
        .insert({
          provider: "E2E SEO Signed-In CTA Provider",
          program_name: `Fixture scholarship ${i} for the signed-in CTA test`,
          degree_levels: ["msc"],
          field_tags: [],
          funding_type: "full",
          funding_covers: ["tuition"],
          eligibility_nationalities: ["Nigeria"],
          official_url: "https://example.test/e2e-seo-signed-in-cta",
          moderation_status: "verified",
          dedup_fingerprint: `e2e-seo-signed-in-cta-scholarship-${randomUUID()}`,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`fixture scholarship: ${error?.message}`);
      createdScholarshipIds.push(data.id);
    }
  }

  /*
   * `expectedHref` per page, not just the shared link text — /jobs/remote
   * and /jobs/remote/[country] carry their own filter through to /jobs
   * (`?workType=remote`, `?workType=remote&country=<TrackedCountry>`) so a
   * returning visitor lands back on the same filtered view rather than a
   * generic feed to re-filter by hand. /jobs/in/[city] has no matching city
   * filter on /jobs to hand off to, so plain "/jobs" there is correct, not
   * an oversight — the assertion below still pins it explicitly so a future
   * change can't silently drop the other two back to generic without this
   * test moving.
   *
   * `breadcrumbHref` is a SEPARATE, constant "/jobs" on all three — the
   * "← Talentrah home" breadcrumb always means generic /jobs, matching the
   * masthead wordmark it duplicates, regardless of which filtered view the
   * lower CTA hands back to. On /jobs/in/[city] this happens to be the same
   * literal string as `expectedHref` — the two assertions below still check
   * it independently, because that coincidence is exactly what let the two
   * links drift apart on the other pages without anyone noticing.
   */
  const PAGES = [
    { path: "/jobs/in/lagos", label: "city", expectedHref: "/jobs", breadcrumbHref: "/jobs" },
    {
      path: "/jobs/remote",
      label: "remote",
      expectedHref: "/jobs?workType=remote",
      breadcrumbHref: "/jobs",
    },
    {
      path: "/jobs/remote/nigeria",
      label: "country",
      expectedHref: "/jobs?workType=remote&country=Nigeria",
      breadcrumbHref: "/jobs",
    },
  ] as const;

  const SCHOLARSHIP_PAGES = [
    { path: "/scholarships/fully-funded", label: "fully-funded" },
    { path: "/scholarships/degree/msc", label: "degree (msc)" },
  ] as const;

  /** React/Next escape `&` as `&amp;` in rendered HTML attribute values. */
  function hrefAttr(href: string): string {
    return `href="${href.replace(/&/g, "&amp;")}"`;
  }

  for (const { path, label, expectedHref, breadcrumbHref } of PAGES) {
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
        `${path}'s signed-in Jobs pointer must carry this page's own filter through as ${expectedHref}, not a generic /jobs`,
      ).toContain(hrefAttr(expectedHref));
      expect(
        body,
        `${path}'s "← Talentrah home" breadcrumb must point at ${breadcrumbHref} for a signed-in visitor, not "/"`,
      ).toContain(breadcrumbHtml(breadcrumbHref));
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
      expect(
        body,
        `${path}'s "← Talentrah home" breadcrumb must stay "/" for a signed-out visitor`,
      ).toContain(breadcrumbHtml("/"));
    });
  }

  for (const { path, label } of SCHOLARSHIP_PAGES) {
    test(`${label} page (${path}): signed in sees the Scholarships pointer, not the signup pitch`, async ({
      authedPage,
    }) => {
      await seedFullyFundedMscScholarships();

      const res = await authedPage.request.get(path);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body, `${path} still pitches signup to a signed-in visitor`).not.toContain(
        "Create a free account",
      );
      expect(body, `${path} is missing the signed-in Scholarships pointer`).toContain(
        "Go to Scholarships to track these",
      );
      expect(
        body,
        `${path}'s "← Talentrah home" breadcrumb must point at /jobs for a signed-in visitor, not "/"`,
      ).toContain(breadcrumbHtml("/jobs"));
    });
  }

  for (const { path, label } of SCHOLARSHIP_PAGES) {
    test(`${label} page (${path}): signed out still gets the signup pitch — proves the test would have caught the bug`, async ({
      request,
    }) => {
      await seedFullyFundedMscScholarships();

      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body, `${path} lost its anonymous signup pitch`).toContain(
        "Create a free account to save and track these",
      );
      expect(
        body,
        `${path} leaked the signed-in Scholarships pointer to a signed-out visitor`,
      ).not.toContain("Go to Scholarships to track these");
      expect(
        body,
        `${path}'s "← Talentrah home" breadcrumb must stay "/" for a signed-out visitor`,
      ).toContain(breadcrumbHtml("/"));
    });
  }
});
