/**
 * Real-PDF end-to-end regression test for Stage 3.1's "Import my CV" start
 * state — the founder-mandated corrected flow, and the whole reason this
 * feature has its own parse route rather than reusing /api/resume/parse.
 *
 * Same fixture pattern as e2e/resume-upload.spec.ts: a minimal but genuinely
 * valid PDF built at test time (buildPdf()), not a committed binary, so the
 * fixture can't be quietly faked. That file's own header explains why this
 * has to be a real PDF through the real pipeline rather than a unit test
 * with a stubbed parser — the same reasoning applies here unchanged; parsing
 * is heuristic-first and reaches high confidence on a well-formed resume
 * without ever calling the LLM, so this exercises real code for free.
 *
 * WHAT THIS PROVES THAT resume-upload.spec.ts DOES NOT: that importing a CV
 * to style it in the Resume Builder creates a NEW `is_base: false` row and
 * leaves the user with NO `is_base: true` resume at all — i.e. it never
 * calls upsertBaseResume, never touches the canonical resume Auto-Apply
 * would submit. That is the founder's explicit correction for this feature;
 * this is the test that would fail if a future change routed "Import my CV"
 * back through /api/resume/parse.
 */
import { test, expect, admin } from "./fixtures/authed";

const RESUME_TEXT = [
  "Adaeze Nwachukwu",
  "adaeze.imported@example.com | +234 802 000 1111 | Lagos, Nigeria",
  "",
  "SUMMARY",
  "Frontend engineer with five years building React applications.",
  "",
  "EXPERIENCE",
  "Senior Frontend Engineer, Flutterwave, Lagos, 2022 - 2026",
  "",
  "EDUCATION",
  "BSc Computer Science, University of Ibadan, 2014 - 2018",
  "",
  "SKILLS",
  "React, TypeScript, GraphQL, Jest, Accessibility",
];

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

test("importing a real PDF CV in the Resume Builder creates a builder resume, never the base resume", async ({
  authedPage,
  testUser,
}) => {
  const pdf = buildPdf(RESUME_TEXT);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await authedPage.goto("/resume-builder");

  // First free (unlocked) template's "Use this template" link → the
  // start-state chooser.
  await authedPage.getByRole("button", { name: "Use this template" }).first().click();
  await authedPage.waitForURL(/\/resume-builder\/new\?templateId=/);
  await expect(authedPage.getByRole("heading", { name: "How do you want to start?" })).toBeVisible();

  // This fresh test user has no base resume, so the "Import my CV" panel
  // goes straight to the uploader rather than showing "Use my existing
  // resume" first.
  const fileInput = authedPage.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "resume.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });

  // Farah's parse summary, then the confirmation "Use this" submit.
  await expect(authedPage.getByText(/farah found \d+ skills? and \d+ work experience/i)).toBeVisible({
    timeout: 15000,
  });
  await authedPage.getByRole("button", { name: "Use this" }).click();

  await authedPage.waitForURL(/\/resume-builder\/edit\?resumeId=/);
  const resumeId = new URL(authedPage.url()).searchParams.get("resumeId")!;

  // The editor is pre-filled with the parsed content, not an empty form —
  // the whole point of this feature.
  //
  // NOT getByLabel(): TextField (src/components/ui/text-field.tsx) only
  // wires `htmlFor`/`id` together when a caller passes an explicit `id` or
  // `name`, and every field in the editor's Contact section
  // (resume-editor.tsx) passes neither — so these <label>/<input> pairs are
  // visually associated but not programmatically associated, and
  // getByLabel() (correctly) finds nothing. That's a pre-existing gap in the
  // editor, unrelated to this feature; flagged separately rather than fixed
  // here. The adjacent-sibling selector below matches TextField's actual
  // DOM shape (label immediately followed by its input) so this test still
  // verifies the right content landed in the right field.
  await expect(authedPage.locator('label:text-is("Full name") + input')).toHaveValue("Adaeze Nwachukwu");
  await expect(authedPage.locator('label:text-is("Email") + input')).toHaveValue(
    "adaeze.imported@example.com",
  );

  // The live preview (Stage 3.1's replacement for the separate preview page)
  // reflects the same content, without navigating anywhere.
  await expect(authedPage.getByText("Live preview")).toBeVisible();

  // THE CRITICAL ASSERTION: no is_base=true resume exists for this user at
  // all. Importing a CV to style it must never have called upsertBaseResume.
  const { data: baseRows } = await admin
    .from("resumes")
    .select("id")
    .eq("user_id", testUser.id)
    .eq("is_base", true);
  expect(baseRows ?? [], "the base resume must not exist — nothing should have created one").toHaveLength(0);

  // And the resume the editor landed on IS a builder resume, source "builder".
  const { data: builderResume } = await admin
    .from("resumes")
    .select("is_base, source")
    .eq("id", resumeId)
    .single();
  expect(builderResume?.is_base).toBe(false);
  expect(builderResume?.source).toBe("builder");
});
