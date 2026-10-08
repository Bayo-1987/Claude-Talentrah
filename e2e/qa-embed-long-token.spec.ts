/**
 * QA proof (RED, P3, local): the framed widget page scrolls sideways at 320px when a job title contains one long unbroken token
 * (the same data-driven class as the Amherst scholarship note). Normal long titles with spaces wrap fine.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { deleteOrgsCascade, deletePostingsCascade } from "../tests/support/delete-orgs";

test("the framed widget has no horizontal overflow at 320px with a long unbroken job title", async ({ authedPage: page, testUser }) => {
  // The embed is the neutral page for everyone while the server-side switch is off, which would make this test pass for the wrong reason: run it against an app started with EMBED_WIDGET_ENABLED=1.
  test.skip(process.env.EMBED_WIDGET_ENABLED !== "1", "the app under test must run with EMBED_WIDGET_ENABLED=1");
  const tag = randomUUID().slice(0, 6);
  const { data: org } = await admin.from("organizations").insert({ name: `E2E Widget Co QAL${tag}`, created_by: testUser.id, verified: true }).select("id").single();
  await admin.from("organization_members").insert({ organization_id: org!.id, user_id: testUser.id, role: "owner" });
  await admin.from("employer_widgets").insert({ organization_id: org!.id, enabled: true, max_items: 5 });
  const { data: job, error } = await admin.from("job_postings").insert({ source_type: "internal", organization_id: org!.id, company_name: "QA Co", title: `Averyveryveryveryverylongunbrokenjobtitletokenwithoutanyspacesatall${tag}`, description: "x".repeat(120), location: "Abuja, Nigeria", work_type: "remote", employment_type: "full_time", structured_jd: { skills: ["sql"] }, status: "open", dedup_fingerprint: randomUUID() }).select("id").single();
  if (error) throw new Error(error.message);
  try {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/embed/jobs/${org!.id}`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw, `scrollWidth ${sw}px must be at most 320px`).toBeLessThanOrEqual(320);
  } finally {
    await deletePostingsCascade(admin, [job!.id]);
    await admin.from("employer_widgets").delete().eq("organization_id", org!.id);
    await deleteOrgsCascade(admin, [org!.id]);
  }
});
