/**
 * send-447 follow-up — `searchJobPostings` (src/lib/admin/moderation/search.ts)
 * is a SERVICE-ROLE reader of `job_postings`, so it bypasses the RLS policy
 * that otherwise keeps a `draft` posting invisible to everyone but its own
 * org. Found while auditing every service-role/cron reader of `job_postings`
 * for the new `draft` status (the ticket's own explicit ask) — this function
 * was a genuine, unaddressed gap: it excluded `removed` but not `draft`, in
 * all four of its query paths (the empty-query "browse", and the
 * title/company/organisation `ilike` searches).
 *
 * A real, live consequence, not a theoretical one: an admin using this tool
 * to "find a specific posting to remove it" would see — and could act on —
 * another organisation's still-private, unpublished draft, by title,
 * company and location, the moment they opened the page (the empty-query
 * path needs no search term at all).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { searchJobPostings } from "@/lib/admin/moderation/search";

let owner: TestUser;
let orgId: string;
const jobIds: string[] = [];
const tag = randomUUID().slice(0, 8);
const DRAFT_TITLE = `MODSEARCHDRAFT-TEST Draft Role ${tag}`;
const OPEN_TITLE = `MODSEARCHDRAFT-TEST Open Role ${tag}`;

async function makeJob(status: "open" | "draft", title: string) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: "MODSEARCHDRAFT-TEST Co",
      title,
      description: "Fixture posting for the moderation-search draft-exclusion suite.",
      structured_jd: {},
      status,
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture job (${status}): ${error.message}`);
  jobIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  owner = await createTestUser("modsearchdraft-owner");

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ name: `MODSEARCHDRAFT-TEST Org ${tag}`, created_by: owner.id, verified: true })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  orgId = org.id;

  await makeJob("draft", DRAFT_TITLE);
  await makeJob("open", OPEN_TITLE);
}, 60_000);

afterAll(async () => {
  if (jobIds.length) await admin.from("job_postings").delete().in("id", jobIds);
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  await deleteTestUsers([owner.id]);
});

describe("searchJobPostings excludes draft postings (send-447 follow-up)", () => {
  it("the empty-query browse never surfaces a draft", async () => {
    // Not scoped to this fixture's own org — the empty-query path takes no
    // filter at all, and this is a live, shared, concurrently-used dev
    // database, so asserting the OPEN fixture also appears in the top
    // RESULT_LIMIT rows (ranked by posted_at across every posting in the
    // project) would be a real, unrelated flake risk. The negative
    // assertion below is what this test exists to prove either way; the
    // other three tests below already prove the search PATH itself finds a
    // real, matching row when given one.
    const results = await searchJobPostings("");
    expect(results.map((r) => r.title), "a draft leaked into the unfiltered admin browse").not.toContain(
      DRAFT_TITLE,
    );
  });

  it("searching by the draft's own exact title returns nothing for it", async () => {
    const results = await searchJobPostings(DRAFT_TITLE);
    expect(results.map((r) => r.title)).not.toContain(DRAFT_TITLE);
  });

  it("searching by the open posting's own exact title still finds it (the search path itself isn't broken)", async () => {
    const results = await searchJobPostings(OPEN_TITLE);
    expect(results.map((r) => r.title)).toContain(OPEN_TITLE);
  });

  it("searching by the shared organisation name never surfaces the draft alongside the open posting", async () => {
    const results = await searchJobPostings("MODSEARCHDRAFT-TEST Org");
    const titles = results.map((r) => r.title);
    expect(titles).not.toContain(DRAFT_TITLE);
    expect(titles).toContain(OPEN_TITLE);
  });
});
