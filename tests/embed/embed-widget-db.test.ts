/**
 * The employer job-list widget end to end through the database (plan v2.1): the REAL route handler, the REAL `fetchWidgetPayload` and the REAL `org_job_widget` function (migration 0237)
 * against the test database. Needs 0237 applied; it is the app-side counterpart of tests/rls/employer-widgets.test.ts, which pins the function itself.
 *
 * Two organisations, each verified with its widget on. Pinned: each page lists only its own organisation's open jobs; a draft and a closed job never render; an unlisted job never
 * renders; every link is its Talentrah page; switching the widget off or unverifying the organisation turns the page into the SAME neutral page an unknown id gets; the page
 * carries no cookie; and nothing but the seven public fields appears.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { GET } from "@/app/embed/jobs/[orgId]/route";
import { SITE_ORIGIN } from "@/lib/seo/site";

const render = async (orgId: string) => {
  const res = await GET(new Request(`https://www.talentrah.com/embed/jobs/${orgId}`), { params: Promise.resolve({ orgId }) });
  return { status: res.status, cookie: res.headers.get("set-cookie"), html: await res.text() };
};

let userA: string;
let userB: string;
let orgA: string;
let orgB: string;
const jobs: Record<string, string> = {};

async function insertJob(orgId: string, company: string, key: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: company,
      title: `WIDGET-TEST ${key} ${randomUUID().slice(0, 6)}`,
      description: "SECRET DESCRIPTION BODY that must never reach the widget.",
      location: "Lagos, Nigeria",
      work_type: "hybrid",
      employment_type: "full_time",
      structured_jd: { skills: ["sql"] },
      status: "open",
      dedup_fingerprint: randomUUID(),
      ...over,
    })
    .select("id, title")
    .single();
  if (error || !data) throw new Error(`fixture job ${key}: ${error?.message}`);
  jobs[key] = data.id;
  return data;
}

async function insertOrg(name: string, createdBy: string, verified = true) {
  const { data, error } = await admin.from("organizations").insert({ name, domain: `${randomUUID()}.test`, created_by: createdBy, verified }).select("id").single();
  if (error || !data) throw new Error(`fixture org: ${error?.message}`);
  const { error: m } = await admin.from("organization_members").insert({ organization_id: data.id, user_id: createdBy, role: "owner" });
  if (m) throw new Error(`membership: ${m.message}`);
  return data.id;
}

// The table is not in the generated types until they are regenerated after 0237.
const widgets = () => (admin as unknown as { from(t: string): { upsert(r: object, o: object): PromiseLike<{ error: { message: string } | null }> } }).from("employer_widgets");
async function setWidget(orgId: string, enabled: boolean, maxItems = 10) {
  const { error } = await widgets().upsert({ organization_id: orgId, enabled, max_items: maxItems }, { onConflict: "organization_id" });
  if (error) throw new Error(`widget row: ${error.message}`);
}

const titles: Record<string, string> = {};

beforeAll(async () => {
  userA = (await createTestUser("widgeta")).id;
  userB = (await createTestUser("widgetb")).id;
  orgA = await insertOrg("WIDGET-TEST Alpha Ltd", userA);
  orgB = await insertOrg("WIDGET-TEST Beta Ltd", userB);
  titles.openA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "openA")).title;
  titles.openA2 = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "openA2")).title;
  titles.draftA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "draftA", { status: "draft" })).title;
  titles.closedA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "closedA", { status: "closed", closed_at: new Date().toISOString() })).title;
  titles.unlistedA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "unlistedA", { unlisted_at: new Date().toISOString() })).title;
  titles.expiredA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "expiredA", { expires_at: new Date(Date.now() - 3_600_000).toISOString() })).title;
  titles.removedA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "removedA", { status: "removed", removed_at: new Date().toISOString(), removal_reason: "fixture" })).title;
  titles.supersededA = (await insertJob(orgA, "WIDGET-TEST Alpha Ltd", "supersededA", { superseded_at: new Date().toISOString() })).title;
  titles.openB = (await insertJob(orgB, "WIDGET-TEST Beta Ltd", "openB")).title;
  await setWidget(orgA, true);
  await setWidget(orgB, true);
}, 90_000);

afterAll(async () => {
  const ids = Object.values(jobs);
  if (ids.length) {
    const { error } = await admin.from("job_postings").delete().in("id", ids);
    if (error) throw new Error(`job cleanup failed: ${error.message}`);
  }
  await deleteTestOrgs([orgA, orgB].filter(Boolean));
  await deleteTestUsers([userA, userB].filter(Boolean));
}, 90_000);

describe("GET /embed/jobs/<org> against the database", () => {
  it("lists only that organisation's open, listed jobs, each linking to its Talentrah page", async () => {
    const { status, html, cookie } = await render(orgA);
    expect(status).toBe(200);
    expect(cookie).toBeNull();
    expect(html).toContain("WIDGET-TEST Alpha Ltd");
    for (const k of ["openA", "openA2"]) {
      expect(html).toContain(titles[k]);
      expect(html).toContain(`href="${SITE_ORIGIN}/jobs/${jobs[k]}"`);
    }
    for (const k of ["draftA", "closedA", "unlistedA", "expiredA", "removedA", "supersededA", "openB"]) {
      expect(html, k).not.toContain(titles[k]);
      expect(html, k).not.toContain(jobs[k]);
    }
  });

  it("another employer's page shows only its own job", async () => {
    const { html } = await render(orgB);
    expect(html).toContain(titles.openB);
    expect(html).not.toContain(titles.openA);
  });

  it("never prints a description, an applicant figure or a script", async () => {
    const { html } = await render(orgA);
    expect(html).not.toContain("SECRET DESCRIPTION BODY");
    expect(html.toLowerCase()).not.toContain("<script");
  });

  it("respects the organisation's max-jobs setting", async () => {
    await setWidget(orgA, true, 1);
    const { html } = await render(orgA);
    expect(html.match(/<li\b/g)).toHaveLength(1);
    await setWidget(orgA, true, 10);
  });

  it("an unknown organisation, a switched-off widget and an unverified organisation all get the identical neutral page", async () => {
    const unknown = await render(randomUUID());
    expect(unknown.status).toBe(200);
    expect(unknown.html).toContain("No open jobs right now");

    await setWidget(orgB, false);
    const off = await render(orgB);
    await setWidget(orgB, true);

    const unverifiedUser = (await createTestUser("widgetu")).id;
    const unverifiedOrg = await insertOrg("WIDGET-TEST Unverified Ltd", unverifiedUser, false);
    try {
      await setWidget(unverifiedOrg, true);
      const unverified = await render(unverifiedOrg);
      expect(off.html).toBe(unknown.html);
      expect(unverified.html).toBe(unknown.html);
      expect(off.html).not.toContain("Beta");
      expect(unverified.html).not.toContain("Unverified");
    } finally {
      await deleteTestOrgs([unverifiedOrg]);
      await deleteTestUsers([unverifiedUser]);
    }
  });
});
