/**
 * Real-PDF end-to-end regression test for the dead end closed by
 * FirstBaseResumePanel (src/app/(app)/resume-builder/first-base-resume-panel.tsx):
 * a user who skips /onboarding and never uploads a resume any other way had
 * ZERO reachable UI path to ever create a base (is_base=true) resume.
 * /onboarding permanently redirects away once skipped (0112,
 * onboarding_skipped_at), and ResumeListRow's own "Replace" button only
 * renders on a row that is ALREADY is_base=true — "Build a resume"/"Import
 * my resume" deliberately create is_base=false builder rows only (the
 * founder's own corrected flow, covered unchanged by
 * resume-builder-import.spec.ts), so neither reaches it either.
 *
 * THE EXACT STATE THE FOUNDER'S OWN SCREENSHOTS SHOWED: skipped onboarding,
 * zero base resumes, but a builder-only resume already sitting in "Your
 * resumes" — proving the panel shows even when the resumes list is
 * non-empty, not just when it's totally empty (resume-builder-import.spec.ts
 * already covers the fully-empty case incidentally, but never asserts on
 * this panel, which didn't exist before this fix).
 *
 * Same fixture pattern as resume-builder-replace.spec.ts: a minimal but
 * genuinely valid PDF built at test time (buildPdf()), not a committed
 * binary — see that file's own header for why this has to be a real PDF
 * through the real pipeline.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

const FIXTURE_SKILL = "Rust";

function fixtureLines(name: string, email: string, distinctiveSkill: string): string[] {
  return [
    name,
    `${email} | +234 803 000 3333 | Enugu, Nigeria`,
    "",
    "SUMMARY",
    "Embedded systems engineer with four years shipping firmware.",
    "",
    "EXPERIENCE",
    "Firmware Engineer, Interswitch, Lagos, 2022 - 2026",
    "",
    "EDUCATION",
    "BEng Electrical Engineering, University of Nigeria Nsukka, 2015 - 2019",
    "",
    "SKILLS",
    `${distinctiveSkill}, C++, RTOS, Embedded Linux`,
  ];
}

/** A minimal but genuinely valid PDF, built here rather than committed as a binary. */
function buildPdf(lines: string[]): Buffer {
  const content =
    "BT\n/F1 11 Tf\n50 760 Td\n14 TL\n" +
    lines.map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj\nT*\n`).join("") +
    "ET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

test("a user who skipped onboarding and has only a builder resume can still create a base resume, and the jobs feed placeholder banner clears", async ({
  authedPage,
  testUser,
}, testInfo) => {
  // ── Precondition: exactly the state the founder's own screenshots showed.
  // Skipped onboarding (the marker skipOnboardingAction writes) —
  // /onboarding would otherwise be the obvious "just go upload it there"
  // suggestion, and this proves that door is really shut for this user.
  const { error: skipError } = await admin
    .from("profiles")
    .update({ onboarding_skipped_at: new Date().toISOString() })
    .eq("id", testUser.id);
  expect(skipError).toBeNull();

  // A builder-only (is_base=false) resume already exists — "Build a
  // resume"/"Import my resume" already happened once, same as the founder's
  // report. Inserted directly rather than via seedBaseResume (which writes
  // is_base=true) to model exactly this row shape.
  const { error: builderRowError } = await admin.from("resumes").insert({
    user_id: testUser.id,
    title: "Styled for Interswitch",
    is_base: false,
    source: "builder",
    structured_content: {
      contact: { name: "Builder Row", email: "builder-row@talentrah.test", location: "Lagos, Nigeria" },
      summary: "",
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
    },
  });
  expect(builderRowError).toBeNull();

  // No base resume exists yet — the precondition the whole bug is about.
  const { data: baseRowsBefore } = await admin
    .from("resumes")
    .select("id")
    .eq("user_id", testUser.id)
    .eq("is_base", true);
  expect(baseRowsBefore ?? []).toHaveLength(0);

  // ── The jobs feed shows the "no resume yet" placeholder banner beforehand.
  await authedPage.goto("/jobs");
  await expect(authedPage.getByText(/you don.t have a resume yet/i)).toBeVisible();

  // ── The panel this fix adds is immediately visible on /resume-builder —
  // no extra click to reveal the uploader, and the existing builder row is
  // still listed alongside it (proving this isn't just the empty-list case).
  await authedPage.goto("/resume-builder");
  await expect(authedPage.getByTestId("first-base-resume-panel")).toBeVisible();
  await expect(authedPage.getByText("Styled for Interswitch")).toBeVisible();
  await expect(authedPage.getByTestId("replace-base-resume")).toBeVisible();

  const pdf = buildPdf(fixtureLines("Ngozi Eze", "ngozi.eze@example.com", FIXTURE_SKILL));
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  const fileInput = authedPage.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: pdf });

  await expect(authedPage.getByText(/farah found \d+ skills? and \d+ work experience/i)).toBeVisible({
    timeout: 15000,
  });

  // First-time copy, not "replace" wording — there is nothing to replace.
  await expect(authedPage.getByText(/this becomes your base resume/i)).toBeVisible();

  await testInfo.attach("first-upload-preview", {
    body: await authedPage.screenshot(),
    contentType: "image/png",
  });

  await authedPage.getByTestId("replace-base-resume-confirm").click();
  await expect(authedPage.getByTestId("replace-base-resume-done")).toBeVisible({ timeout: 15000 });
  await expect(authedPage.getByTestId("replace-base-resume-done")).toContainText(
    "Your resume has been saved",
  );

  await testInfo.attach("first-upload-confirmed", {
    body: await authedPage.screenshot(),
    contentType: "image/png",
  });

  // ── THE CORE ASSERTION: exactly one is_base=true row now exists, holding
  // the uploaded content — upsertBaseResume's plain-INSERT branch, reached
  // through this panel for the first time ever.
  const { data: baseRowsAfter } = await admin
    .from("resumes")
    .select("id, structured_content")
    .eq("user_id", testUser.id)
    .eq("is_base", true);
  expect(baseRowsAfter).toHaveLength(1);
  const savedJson = JSON.stringify(baseRowsAfter![0].structured_content);
  expect(savedJson).toContain(FIXTURE_SKILL);
  expect(savedJson).toContain("Ngozi Eze");

  // The pre-existing builder row must survive untouched — this panel must
  // never repoint or delete it.
  const { data: allRows } = await admin.from("resumes").select("id, is_base").eq("user_id", testUser.id);
  expect(allRows).toHaveLength(2);

  // ── The jobs feed placeholder banner is gone for this exact user journey
  // (skip → builder resume → THEN base resume), not just the
  // uploaded-at-onboarding path resume-upload.spec.ts already covers.
  await authedPage.goto("/jobs");
  await expect(authedPage.getByText(/you don.t have a resume yet/i)).not.toBeVisible();

  // ── And back on /resume-builder, the panel is gone — the base-resume row
  // now shows the ordinary "Replace" control instead, unchanged and not
  // doubled up alongside this one.
  await authedPage.goto("/resume-builder");
  await expect(authedPage.getByTestId("first-base-resume-panel")).not.toBeVisible();
  await expect(authedPage.getByTestId("resume-replace").first()).toBeVisible();
});

test("a user who already has a base resume never sees the first-upload panel", async ({
  authedPage,
  testUser,
}) => {
  // Same precondition otherwise (skipped onboarding is irrelevant once a
  // base resume exists — /onboarding's own redirect already covers that
  // case) — the one variable under test is hasBaseResume itself.
  await seedBaseResume(testUser.id);

  await authedPage.goto("/resume-builder");
  await expect(authedPage.getByTestId("resume-replace")).toBeVisible();
  await expect(
    authedPage.getByTestId("first-base-resume-panel"),
    "REGRESSION: the first-upload panel must not show or double up once a base resume exists",
  ).not.toBeVisible();
});
