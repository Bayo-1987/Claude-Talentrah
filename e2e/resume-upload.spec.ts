/**
 * Real-PDF regression test for resume upload.
 *
 * ── Why this is an e2e test and not a unit test ─────────────────────────
 *
 * The bug it guards only exists once Next bundles the server. pdf-parse
 * pulls in pdfjs-dist's legacy build, and pdf.js resolves its worker script
 * relative to its own module location; after bundling, that path points into
 * a hashed chunk directory where the worker was never emitted, and every
 * upload fails with "Setting up fake worker failed".
 *
 * A Vitest test calling extractResumeText() directly would have passed
 * happily the whole time it was broken in the product — Vitest doesn't
 * bundle through Next. So the assertion has to travel the real route on the
 * real server, which is what this does.
 *
 * ── Why the file must be a real PDF ────────────────────────────────────
 *
 * A stubbed or mocked parser would also have hidden this. The fixture is a
 * genuine PDF generated at test time, and it goes through the real
 * /api/resume/parse route: multipart upload, pdf.js extraction, the
 * heuristic field extractor, and the resumes write.
 *
 * NOTE FOR THE GOLDEN-PATH WORK (PR #20): that suite stubs the LLM provider,
 * which is right for tailoring. It must NOT be extended to stub resume
 * parsing. This bug is the evidence — the parse step is exactly where a
 * stub hides a real, user-facing failure. Parsing here is heuristic-first
 * and returns "high" confidence on a well-formed resume, so it never
 * reaches the LLM fallback and costs nothing to exercise for real.
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RESUME_TEXT = [
  "Amaka Obi",
  "amaka.obi@example.com | +234 800 111 2222 | Lagos, Nigeria",
  "",
  "SUMMARY",
  "Backend engineer with six years building payment systems in fintech.",
  "",
  "EXPERIENCE",
  "Senior Backend Engineer, Paystack, Lagos, 2021 - 2026",
  "",
  "EDUCATION",
  "BSc Computer Science, University of Lagos, 2015 - 2019",
  "",
  "SKILLS",
  "Node.js, TypeScript, Postgres, Kubernetes, Redis",
];

/**
 * A minimal but genuinely valid PDF, built here rather than committed as a
 * binary: the point is that pdf.js really parses it, and a checked-in blob
 * is harder to review and easy to mistake for a fixture that's been quietly
 * neutered.
 */
function buildPdf(lines: string[]): Buffer {
  const content =
    "BT\n/F1 11 Tf\n50 760 Td\n14 TL\n" +
    lines
      .map((l) => `(${l.replace(/([()\\])/g, "\\$1")}) Tj\nT*\n`)
      .join("") +
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

test("a real PDF resume uploads, parses, and is stored", async ({ request }) => {
  const email = `upload-${randomUUID()}@talentrah.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw createErr;
  const userId = created.user.id;

  try {
    // Real session, established the same way the RLS suite does.
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link) throw linkErr ?? new Error("No magic link returned.");
    const jar = new Map<string, string>();
    const captured: { name: string; value: string }[] = [];
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (l) => {
          for (const c of l) {
            jar.set(c.name, c.value);
            captured.push({ name: c.name, value: c.value });
          }
        },
      },
    });
    await ssr.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });

    const pdf = buildPdf(RESUME_TEXT);
    // Guard the fixture itself — a truncated or non-PDF buffer would make a
    // failure here look like a parser regression.
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const res = await request.post("/api/resume/parse", {
      headers: { Cookie: `${captured[0].name}=${encodeURIComponent(captured[0].value)}` },
      multipart: {
        file: { name: "resume.pdf", mimeType: "application/pdf", buffer: pdf },
      },
    });

    const body = await res.json();
    // The original failure was a 422 whose message named the missing worker.
    // Asserting on it explicitly means a re-break reads as itself rather
    // than as a generic upload failure.
    expect(
      JSON.stringify(body),
      "pdf.js could not resolve its worker — check serverExternalPackages in next.config.ts",
    ).not.toContain("fake worker");
    expect(res.status(), `upload failed: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);

    // Parsed content, not just a 200: a route that silently stored an empty
    // resume would otherwise pass.
    expect(body.resume.contact.name).toBe("Amaka Obi");
    expect(body.resume.contact.email).toBe("amaka.obi@example.com");
    expect(body.resume.skills.join(" ")).toContain("TypeScript");

    // And it was actually persisted as the user's base resume.
    const { data: stored } = await admin
      .from("resumes")
      .select("id, is_base")
      .eq("user_id", userId)
      .eq("is_base", true);
    expect(stored, "the parsed resume should be saved as the base resume").toHaveLength(1);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});

test("the onboarding greeting reads correctly when the user has no first name", async ({
  browser,
  baseURL,
}) => {
  // Every Google/LinkedIn signup lands here without a first_name (see the PR
  // description), which used to render "Ready to land your dream job, ?".
  const email = `noname-${randomUUID()}@talentrah.test`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;

  try {
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link) throw linkErr ?? new Error("No magic link returned.");
    const jar = new Map<string, string>();
    const captured: { name: string; value: string }[] = [];
    const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (l) => {
          for (const c of l) {
            jar.set(c.name, c.value);
            captured.push({ name: c.name, value: c.value });
          }
        },
      },
    });
    await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });

    const url = new URL(baseURL ?? "http://localhost:3000");
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: captured[0].name,
        value: captured[0].value,
        domain: url.hostname,
        path: "/",
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    await page.goto("/onboarding");

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText("Ready to land your dream job?");
    await expect(heading, "a dangling comma means the name interpolated blank").not.toContainText(
      ", ?",
    );

    // Positive control: give the same user a name and the greeting must
    // actually use it. Without this, deleting the interpolation entirely
    // would satisfy the assertion above.
    await admin.from("profiles").update({ first_name: "Amaka" }).eq("id", created.user.id);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ready to land your dream job, Amaka?",
    );

    await context.close();
  } finally {
    await admin.auth.admin.deleteUser(created.user.id);
  }
});
