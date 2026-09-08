/**
 * Real-PDF end-to-end regression test for the base resume's Replace flow
 * (src/components/resume-builder/replace-base-resume.tsx) — the only
 * existing coverage of this surface before this file, zero (checked the
 * full e2e/ listing: neither resume-builder-import.spec.ts nor
 * resume-upload.spec.ts drive Replace).
 *
 * Same fixture pattern as resume-builder-import.spec.ts: a minimal but
 * genuinely valid PDF built at test time (buildPdf()), not a committed
 * binary — see that file's own header for why this has to be a real PDF
 * through the real pipeline. Two distinct fixtures here, not one, because
 * proving the parse/persist split needs a SECOND upload that never gets
 * confirmed, and proving the confirm path needs to tell "the seed", "the
 * first upload" and "the second upload" apart by content alone.
 *
 * WHAT THIS PROVES THAT NOTHING ELSE DOES: that uploading a file for
 * Replace — once, twice, as many times as someone wants to try a different
 * export — writes nothing until the explicit confirm click, and that the
 * confirm click UPDATEs the existing base resume row rather than inserting
 * a second one. ReplaceBaseResume's own header comment states both of
 * these as the reason the component has three steps instead of one; this
 * is the test that would fail if a future change collapsed them.
 */
import { test, expect, admin, seedBaseResume } from "./fixtures/authed";

const SEED_SKILL = "Postgres"; // from seedBaseResume's own fixture content
const FIXTURE_A_SKILL = "Kubernetes";
const FIXTURE_B_SKILL = "Elixir";

function fixtureLines(name: string, email: string, distinctiveSkill: string): string[] {
  return [
    name,
    `${email} | +234 803 000 2222 | Abuja, Nigeria`,
    "",
    "SUMMARY",
    "Platform engineer with seven years running distributed systems.",
    "",
    "EXPERIENCE",
    "Staff Platform Engineer, Interswitch, Abuja, 2020 - 2026",
    "",
    "EDUCATION",
    "BSc Computer Engineering, Ahmadu Bello University, 2013 - 2017",
    "",
    "SKILLS",
    `${distinctiveSkill}, Terraform, Prometheus, gRPC`,
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

test("replacing the base resume: parse writes nothing, confirm updates the same row", async ({
  authedPage,
  testUser,
}, testInfo) => {
  // ── Precondition: this fresh user needs a base resume before "Replace"
  // exists at all — a fresh authed user has none (resume-builder-import.spec.ts's
  // own comment says so). Reused rather than hand-rolled: seedBaseResume
  // (e2e/fixtures/authed.ts) is the same helper golden-path.spec.ts,
  // onboarding-skip.spec.ts, auto-apply.spec.ts and
  // sign-in-onboarding-gate.spec.ts already trust for exactly this, so a
  // wrong shape here would already be a known, shared problem rather than
  // something this test alone introduced.
  await seedBaseResume(testUser.id);

  const { data: seeded } = await admin
    .from("resumes")
    .select("id, structured_content, updated_at")
    .eq("user_id", testUser.id)
    .eq("is_base", true)
    .single();
  expect(seeded).not.toBeNull();
  const baseResumeId = seeded!.id;
  expect(JSON.stringify(seeded!.structured_content)).toContain(SEED_SKILL);

  const pdfA = buildPdf(fixtureLines("Chidinma Okafor", "chidinma.a@example.com", FIXTURE_A_SKILL));
  const pdfB = buildPdf(fixtureLines("Tunde Bakare", "tunde.b@example.com", FIXTURE_B_SKILL));
  expect(pdfA.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pdfB.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await authedPage.goto("/resume-builder");
  await authedPage.getByTestId("resume-replace").click();
  await expect(authedPage.getByTestId("replace-base-resume")).toBeVisible();

  // ── Step 1: upload fixture A, see the real parse preview, then upload
  // fixture B WITHOUT ever confirming fixture A. Two uploads, zero writes.
  const fileInput = authedPage.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "resume-a.pdf", mimeType: "application/pdf", buffer: pdfA });

  await expect(authedPage.getByText(/farah found \d+ skills? and \d+ work experience/i)).toBeVisible({
    timeout: 15000,
  });

  await testInfo.attach("replace-flow-preview", {
    body: await authedPage.screenshot(),
    contentType: "image/png",
  });

  const { data: afterFirstUpload } = await admin
    .from("resumes")
    .select("id, structured_content, updated_at")
    .eq("id", baseResumeId)
    .single();
  expect(afterFirstUpload!.id).toBe(baseResumeId);
  expect(
    afterFirstUpload!.updated_at,
    "a mere upload must not even touch updated_at, not just the content",
  ).toBe(seeded!.updated_at);
  expect(
    JSON.stringify(afterFirstUpload!.structured_content),
    "the parse-preview step must never persist — a mere upload changed the base resume",
  ).toBe(JSON.stringify(seeded!.structured_content));

  // "Try a different file" — back to the upload step, never having confirmed A.
  await authedPage.getByTestId("replace-base-resume-retry").click();
  await fileInput.setInputFiles({ name: "resume-b.pdf", mimeType: "application/pdf", buffer: pdfB });
  await expect(authedPage.getByText(/farah found \d+ skills? and \d+ work experience/i)).toBeVisible({
    timeout: 15000,
  });

  // THE ASSERTION FOR STEP 1: after TWO uploads and zero confirms, the
  // seeded row is still exactly what seedBaseResume wrote — same id, same
  // content, byte for byte.
  const { data: afterSecondUpload } = await admin
    .from("resumes")
    .select("id, structured_content")
    .eq("id", baseResumeId)
    .single();
  expect(afterSecondUpload!.id).toBe(baseResumeId);
  expect(
    JSON.stringify(afterSecondUpload!.structured_content),
    "a second upload before any confirm must also leave the base resume untouched",
  ).toBe(JSON.stringify(seeded!.structured_content));

  // ── Step 2: confirming fixture B actually replaces the row.
  await authedPage.getByTestId("replace-base-resume-confirm").click();
  await expect(authedPage.getByTestId("replace-base-resume-done")).toBeVisible({ timeout: 15000 });
  await expect(authedPage.getByTestId("replace-base-resume-done")).toContainText(
    "Your resume has been updated — Auto-Apply and future tailoring will use this version.",
  );

  await testInfo.attach("replace-flow-confirmed", {
    body: await authedPage.screenshot(),
    contentType: "image/png",
  });

  // Same id — an UPDATE, not a second row — now holding fixture B's content.
  const { data: afterConfirm } = await admin
    .from("resumes")
    .select("id, is_base, structured_content")
    .eq("id", baseResumeId)
    .single();
  expect(afterConfirm!.id).toBe(baseResumeId);
  expect(afterConfirm!.is_base).toBe(true);
  const confirmedJson = JSON.stringify(afterConfirm!.structured_content);
  expect(confirmedJson).toContain(FIXTURE_B_SKILL);
  expect(confirmedJson).toContain("Tunde Bakare");
  expect(confirmedJson, "fixture A was never confirmed and must not be what landed").not.toContain(
    FIXTURE_A_SKILL,
  );
  expect(confirmedJson, "the original seed content must be gone, not merged").not.toContain(SEED_SKILL);

  // Exactly one is_base=true row for this user — a real UPDATE, not an
  // insert alongside a row 0010's own unique partial index would have
  // rejected anyway, but worth asserting the count directly rather than
  // relying on that constraint to have caught it.
  const { data: baseRows } = await admin
    .from("resumes")
    .select("id")
    .eq("user_id", testUser.id)
    .eq("is_base", true);
  expect(baseRows).toHaveLength(1);
});
