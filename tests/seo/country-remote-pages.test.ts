/**
 * loadCountryRemoteJobs (src/lib/seo/landing-page-data.ts) — the honest,
 * actually-filtered per-country remote pages that replace /jobs/remote's
 * dropped geography claim. The load-bearing case, same as country.test.ts's
 * unit coverage but proven here against the real database and the real
 * Supabase `.or()` syntax `countryOrFilter` builds: a blind
 * `workable-nigeria` fixture (location = "Remote", nothing else) must still
 * count toward Nigeria's total, and a real but different-country fixture
 * must never leak into it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deletePostingsCascade } from "../support/delete-orgs";
import { loadCountryRemoteJobs } from "@/lib/seo/landing-page-data";
import { JOB_FRESHNESS_WINDOW_DAYS } from "@/lib/jobs/freshness";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

let userId: string;
let fixtureOrgId: string;
const jobIds: string[] = [];

async function insertPosting(overrides: {
  companyName: string;
  location: string;
  externalSource?: string | null;
  organizationId?: string | null;
}): Promise<string> {
  const isInternal = !overrides.externalSource;
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: isInternal ? "internal" : "external",
      organization_id: isInternal ? (overrides.organizationId ?? fixtureOrgId) : null,
      company_name: overrides.companyName,
      title: `COUNTRY-REMOTE-TEST Role ${randomUUID().slice(0, 8)}`,
      description: "Fixture posting for the country-remote landing page suite.",
      status: "open",
      work_type: "remote",
      location: overrides.location,
      external_source: overrides.externalSource ?? null,
      posted_at: isoAgo(2),
      dedup_fingerprint: `country-remote-test-${randomUUID()}`,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  const user = await createTestUser("countryremote");
  userId = user.id;

  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `COUNTRY-REMOTE-TEST Org ${randomUUID().slice(0, 8)}`, created_by: userId, verified: true })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  fixtureOrgId = org.id;
}, 60_000);

afterAll(async () => {
  await deletePostingsCascade(admin, jobIds);
  if (fixtureOrgId) await admin.from("organizations").delete().eq("id", fixtureOrgId);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("loadCountryRemoteJobs", () => {
  it("returns null for a slug outside the tracked-country list, before any query", async () => {
    expect(await loadCountryRemoteJobs(admin, "not-a-real-country")).toBeNull();
  });

  it(
    "SABOTAGE-PROOF TARGET: a blind workable-nigeria-shaped posting (location literally " +
      "\"Remote\", nothing else) counts toward Nigeria via the source fallback",
    async () => {
      const before = (await loadCountryRemoteJobs(admin, "nigeria"))!.total;
      const blindId = await insertPosting({
        companyName: "COUNTRY-REMOTE-TEST FairMoney-alike",
        location: "Remote",
        externalSource: "schema-org:workable-nigeria",
      });
      const after = await loadCountryRemoteJobs(admin, "nigeria");
      expect(after!.total).toBe(before + 1);
      expect(after!.jobs.map((j) => j.id)).toContain(blindId);
    },
  );

  it(
    "a real but different-country posting never leaks into Nigeria's count, blind or not",
    async () => {
      const before = (await loadCountryRemoteJobs(admin, "nigeria"))!.total;
      // Same shape as a real Wave/Moniepoint row that names a country — just
      // not one of the four tracked ones.
      await insertPosting({ companyName: "COUNTRY-REMOTE-TEST Wave-alike", location: "Dakar, Senegal" });
      const after = await loadCountryRemoteJobs(admin, "nigeria");
      expect(after!.total).toBe(before);
    },
  );

  it("a literal country name in the location is enough without any source fallback", async () => {
    const before = (await loadCountryRemoteJobs(admin, "kenya"))!.total;
    const id = await insertPosting({
      companyName: "COUNTRY-REMOTE-TEST Nairobi Co",
      location: "Nairobi, Nairobi County, Kenya",
    });
    const after = await loadCountryRemoteJobs(admin, "kenya");
    expect(after!.total).toBe(before + 1);
    expect(after!.jobs.map((j) => j.id)).toContain(id);
  });

  it("still respects the 30-day freshness floor — a stale row never counts", async () => {
    const before = (await loadCountryRemoteJobs(admin, "ghana"))!.total;
    const { data, error } = await admin
      .from("job_postings")
      .insert({
        source_type: "external",
        organization_id: null,
        company_name: "COUNTRY-REMOTE-TEST Stale Ghana Co",
        title: `COUNTRY-REMOTE-TEST Stale Role ${randomUUID().slice(0, 8)}`,
        description: "Stale fixture — must not count.",
        status: "open",
        work_type: "remote",
        location: "Remote",
        external_source: "schema-org:workable-ghana",
        posted_at: isoAgo(JOB_FRESHNESS_WINDOW_DAYS + 5),
        dedup_fingerprint: `country-remote-test-stale-${randomUUID()}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
    jobIds.push(data.id);
    const after = await loadCountryRemoteJobs(admin, "ghana");
    expect(after!.total).toBe(before);
  });
});
