import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";
import { ATS_TEST_RESUME } from "@/lib/resume-builder/ats-test-fixture";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { extractPdfText } from "./support/pdf-text";
import { expectedMarkerOrder, actualMarkerOrder } from "./support/ats-markers";
import { installPrintStub } from "./support/print-stub";

/**
 * The employer's "Print / Save as PDF" on an applicant's resume, on a cold
 * font cache — the same guard e2e/print-button-fonts.spec.ts gives the
 * seeker's own button.
 *
 * `EmployerPrintButton` used to call `window.print()` synchronously. Every
 * font here is `font-display: swap`, so an employer clicking on a first visit
 * or a slow connection printed while faces were still loading, i.e. on
 * fallback fonts. It now waits for fonts (bounded) like the seeker's button.
 * This drives the real page and real button with every font file held back
 * 2s, stubs `window.print` to snapshot font state and `page.pdf()` at the
 * instant it is called, and asserts what a real click would have printed.
 *
 * WHAT IS AND ISN'T PROVEN. With the wait removed the FONT-STATE assertion
 * fails (8 faces still loading at print time); with it, it passes — that is
 * the guard. The PDF-content assertion is a general completeness/order check
 * and does not distinguish the two cases; no loss of content from printing
 * early has been reproduced.
 */

const SLUG = "blueprint";
const FONT_DELAY_MS = 2000;

test("Print / Save as PDF on a cold font cache prints the settled applicant resume", async ({
  authedPage: page,
  testUser,
}) => {
  // Seeding (org, posting, seeker, resume, application) is several round trips
  // to Supabase; against a remote project that alone has run 22-34s, right at
  // Playwright's default 30s. The font delay itself adds ~2s.
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  let orgId: string | undefined;
  let seekerId: string | undefined;
  let applicationId: string | undefined;
  let resumeId: string | undefined;

  try {
    const { data: template } = await admin.from("resume_templates").select("id").eq("slug", SLUG).single();
    expect(template, `no resume_templates row for "${SLUG}" — migrations/seed not applied`).toBeTruthy();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: `E2E Print Fonts Co ${suffix}`, created_by: testUser.id, verified: true })
      .select("id")
      .single();
    expect(orgError).toBeNull();
    orgId = org!.id;

    const { error: memberError } = await admin
      .from("organization_members")
      .insert({ organization_id: orgId, user_id: testUser.id, role: "owner" });
    expect(memberError).toBeNull();

    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .insert({
        source_type: "internal",
        organization_id: orgId,
        company_name: `E2E Print Fonts Co ${suffix}`,
        title: `E2E print-fonts role ${suffix}`,
        description: "Fixture posting for the employer print-fonts spec.",
        structured_jd: {},
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: randomUUID(),
      })
      .select("id")
      .single();
    expect(jobError).toBeNull();

    const { data: seeker, error: seekerError } = await admin.auth.admin.createUser({
      email: `e2e-seeker-${randomUUID()}@${suffix}.talentrah.test`,
      email_confirm: true,
    });
    expect(seekerError).toBeNull();
    seekerId = seeker.user!.id;

    const { data: resume, error: resumeError } = await admin
      .from("resumes")
      .insert({
        user_id: seekerId,
        title: "Employer print fonts fixture",
        is_base: false,
        source: "builder",
        template_id: template!.id,
        structured_content: JSON.parse(JSON.stringify(ATS_TEST_RESUME)),
      })
      .select("id")
      .single();
    expect(resumeError).toBeNull();
    resumeId = resume!.id;

    const { data: application, error: applicationError } = await admin
      .from("applications")
      .insert({
        user_id: seekerId,
        job_posting_id: job!.id,
        resume_id: resumeId,
        stage: "applied",
        source: "internal_apply",
        applied_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(applicationError).toBeNull();
    applicationId = application!.id;

    let pdfBuffer: Buffer | undefined;
    await installPrintStub(page, async () => {
      pdfBuffer = await page.pdf({ printBackground: true });
    });

    // A cold cache, made deterministic: every next/font file arrives late.
    await page.route("**/_next/static/media/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
      await route.continue();
    });

    await page.goto(`/employer/jobs/${job!.id}/applicants/${applicationId}/resume`, {
      waitUntil: "domcontentloaded",
    });

    const button = page.getByRole("button", { name: "Print / Save as PDF" });
    await expect(button).toBeEnabled();
    // Observed concurrently, asserted last: it is transient, and asserting it
    // first would hide whether the print itself fired at the right moment.
    const sawPreparing = page
      .getByRole("button", { name: "Preparing PDF…" })
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false);
    await button.click();

    await page.waitForFunction(() => window.__printCalls.length > 0, undefined, { timeout: 15_000 });
    await expect.poll(() => pdfBuffer?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);

    const calls = await page.evaluate(() => window.__printCalls);
    expect(calls, "window.print() should be called exactly once per click").toHaveLength(1);
    // soft: a failure here must not hide whether the captured PDF is also wrong.
    expect.soft(
      calls[0],
      "window.print() ran while fonts were still loading — the PDF would be captured on fallback fonts",
    ).toEqual({ fontsStatus: "loaded", loadingFaces: 0 });

    const expected = expectedMarkerOrder(CATALOG_TEMPLATE_CONFIGS[SLUG]);
    const text = await extractPdfText(pdfBuffer!);
    expect(
      actualMarkerOrder(text, expected),
      `the PDF captured at print time was incomplete or misordered; expected [${expected.join(", ")}]`,
    ).toEqual(expected);

    expect(await sawPreparing, 'the button never showed "Preparing PDF…" while waiting for fonts').toBe(true);
    await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeEnabled();
  } finally {
    if (applicationId) await admin.from("applications").delete().eq("id", applicationId);
    if (resumeId) await admin.from("resumes").delete().eq("id", resumeId);
    if (orgId) await deleteOrgsCascade(admin, [orgId]);
    if (seekerId) await admin.auth.admin.deleteUser(seekerId);
  }
});
