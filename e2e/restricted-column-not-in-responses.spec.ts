/**
 * The restricted column never appears in any response body.
 *
 * `job_postings.admin_review_note` is written only by the admin tools and is meant for the admin who wrote it. Two pages used to read the
 * whole row with `select("*")` (the public job page and the employer's edit page); #719 gave them named column lists. That settled what the
 * pages ASK the database for, but the question that matters is what they SEND: whether the value reaches a browser through the HTML, the
 * RSC payload a client navigation fetches, a share image, or any other response. This spec answers that against the running app, with the
 * real database, one response at a time.
 *
 * HOW IT WORKS. A unique marker is written into `admin_review_note` of an open posting (with the service role: no client can write the
 * column). The posting belongs to a verified organisation so the public can see it, and its owner is the signed-in test user. Every
 * surface below is then requested as the role that can reach it, in BOTH forms a browser can receive (the HTML, and the RSC payload a
 * soft navigation fetches with `RSC: 1`), and the marker must not occur in any body. For the share image the raw bytes are searched.
 *
 * NOT VACUOUS. Each check first proves it read the right thing: the marker really is in the row (read back with the service role), the
 * page answered 200 with the posting's own title in the body, and the RSC response really is a flight payload. A page that 404s or
 * redirects to a login would otherwise "pass" by showing nothing. The assertion helper is itself checked against a body that carries the
 * marker.
 *
 * WHAT IT WOULD CATCH. A page that renders the value, puts it in a prop of a client component (so it travels in the RSC payload), puts it in
 * the JSON-LD, or returns it in JSON. It does not catch the column merely being added to a list that nothing renders; that is a smaller
 * thing and is held by tests/jobs/job-postings-explicit-columns.test.ts.
 *
 * Surfaces: /jobs, /jobs/[id] and its share image, /sitemap.xml (signed out); the employer's Jobs Posted and edit page (as the owning
 * employer); the admin job review page (as a signed-in user who is not an admin).
 */
import { test, expect, admin } from "./fixtures/authed";
import { randomUUID } from "node:crypto";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const MARKER = `RESTRICTED-MARKER-${randomUUID()}`;

let orgId: string;
let jobId: string;
let jobTitle: string;

/** The one assertion every check goes through, so the "not vacuous" test below can run it against a body that carries the marker. */
function assertNoMarker(label: string, body: string | Buffer) {
  const text = typeof body === "string" ? body : body.toString("latin1");
  expect(text.includes(MARKER), `${label}: the restricted column's value is present in the response`).toBe(false);
  // A marker split across a boundary or encoded would slip past an exact match, so the distinctive prefix is checked too.
  expect(text.includes("RESTRICTED-MARKER-"), `${label}: the restricted column's marker prefix is present in the response`).toBe(false);
}

test.beforeEach(async ({ testUser }) => {
  const tag = testUser.id.slice(0, 8);
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `E2E Restricted Co ${tag}`, domain: `restricted-${tag}.example`, created_by: testUser.id, verified: true })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: testUser.id, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);

  jobTitle = `Restricted Column Probe ${tag}`;
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      title: jobTitle,
      company_name: `E2E Restricted Co ${tag}`,
      description: "A fixture posting used to check that an admin-only column never reaches a response. It has a long enough description to render.",
      structured_jd: {},
      dedup_fingerprint: `e2e-restricted-${tag}`,
      posted_at: new Date().toISOString(),
      status: "open",
      location: "Lagos, Nigeria",
      admin_review_note: MARKER,
    })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`fixture posting: ${jobError?.message}`);
  jobId = job.id;
});

test.afterEach(async () => {
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
});

test("the checker is not vacuous: the marker is in the row, and the assertion fails on a body that carries it", async () => {
  const { data, error } = await admin.from("job_postings").select("admin_review_note").eq("id", jobId).single();
  expect(error).toBeNull();
  expect(data?.admin_review_note).toBe(MARKER);
  expect(() => assertNoMarker("self-check", `<html>${MARKER}</html>`)).toThrow();
  expect(() => assertNoMarker("self-check", Buffer.from(`xx${MARKER}xx`))).toThrow();
  expect(() => assertNoMarker("self-check", "<html>nothing here</html>")).not.toThrow();
});

test("signed out: /jobs, /jobs/[id] (HTML and RSC), its share image and the sitemap never carry the marker", async ({ page, request }) => {
  // The posting's own page: 200, with the posting's title (so a 404 or a redirect cannot pass for "clean").
  const detail = await request.get(`/jobs/${jobId}`);
  expect(detail.status()).toBe(200);
  const detailHtml = await detail.text();
  expect(detailHtml).toContain(jobTitle);
  assertNoMarker("GET /jobs/[id] (HTML)", detailHtml);

  // The same page as a client navigation receives it: the RSC flight payload.
  const detailRsc = await request.get(`/jobs/${jobId}`, { headers: { RSC: "1" } });
  expect(detailRsc.status()).toBe(200);
  expect(detailRsc.headers()["content-type"]).toContain("text/x-component");
  const detailRscBody = await detailRsc.text();
  expect(detailRscBody).toContain(jobTitle);
  assertNoMarker("GET /jobs/[id] (RSC payload)", detailRscBody);

  // The structured data lives in the HTML, but name it: it is the one place the page serialises a whole object.
  const ld = await page.goto(`/jobs/${jobId}`);
  expect(ld?.status()).toBe(200);
  const jsonLd = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
  expect(jsonLd).toContain(jobTitle);
  assertNoMarker("JSON-LD", jsonLd);

  // The share image: follow the page's own og:image (Next may hash the route's path), and search the raw bytes.
  const ogContent = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(ogContent, "the page declares an og:image").toBeTruthy();
  const ogUrl = new URL(ogContent!, "http://localhost");
  const og = await request.get(`${ogUrl.pathname}${ogUrl.search}`);
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toMatch(/^image\//);
  assertNoMarker("share image (bytes)", await og.body());

  // The listing and its RSC form.
  for (const [label, headers] of [
    ["GET /jobs (HTML)", undefined],
    ["GET /jobs (RSC payload)", { RSC: "1" }],
  ] as const) {
    const res = await request.get("/jobs", headers ? { headers } : undefined);
    expect(res.status(), label).toBe(200);
    assertNoMarker(label, await res.text());
  }

  // The sitemap lists open postings; it must list the URL and nothing else about the row.
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const sitemapXml = await sitemap.text();
  expect(sitemapXml).toContain("<urlset");
  assertNoMarker("GET /sitemap.xml", sitemapXml);
});

test("the owning employer: Jobs Posted and the edit page never carry the marker, in HTML or RSC", async ({ authedPage }) => {
  const api = authedPage.request;

  const list = await api.get("/employer/jobs");
  expect(list.status()).toBe(200);
  const listHtml = await list.text();
  expect(listHtml).toContain(jobTitle);
  assertNoMarker("GET /employer/jobs (HTML)", listHtml);

  const listRsc = await api.get("/employer/jobs", { headers: { RSC: "1" } });
  expect(listRsc.status()).toBe(200);
  expect(listRsc.headers()["content-type"]).toContain("text/x-component");
  assertNoMarker("GET /employer/jobs (RSC payload)", await listRsc.text());

  const edit = await api.get(`/employer/jobs/${jobId}/edit`);
  expect(edit.status()).toBe(200);
  const editHtml = await edit.text();
  expect(editHtml).toContain(jobTitle);
  assertNoMarker("GET /employer/jobs/[id]/edit (HTML)", editHtml);

  const editRsc = await api.get(`/employer/jobs/${jobId}/edit`, { headers: { RSC: "1" } });
  expect(editRsc.status()).toBe(200);
  expect(editRsc.headers()["content-type"]).toContain("text/x-component");
  const editRscBody = await editRsc.text();
  expect(editRscBody).toContain(jobTitle);
  assertNoMarker("GET /employer/jobs/[id]/edit (RSC payload)", editRscBody);
});

test("a signed-in user who is not an admin: the admin job review page never carries the marker", async ({ authedPage }) => {
  const api = authedPage.request;
  for (const [label, headers] of [
    ["GET /admin/job-review (HTML)", undefined],
    ["GET /admin/job-review (RSC payload)", { RSC: "1" }],
  ] as const) {
    const res = await api.get("/admin/job-review", headers ? { headers } : undefined);
    // Whatever the answer is (a redirect to the admin login, a 404), it is not the review page itself.
    expect(res.url(), `${label}: a non-admin was served the review page`).not.toMatch(/\/admin\/job-review(?:[?#]|$)/);
    assertNoMarker(label, await res.text());
  }
});
