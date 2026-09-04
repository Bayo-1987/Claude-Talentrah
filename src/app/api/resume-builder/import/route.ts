import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseResumeFile } from "@/lib/resume/parse";
import { sanitizeStructuredResume } from "@/lib/resume/sanitize";
import { internalError } from "@/lib/api/admin-auth";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

/**
 * Parses an uploaded file for the Resume Builder's "Import my CV" → "Upload a
 * different file" path — and, deliberately, DOES NOT WRITE ANYTHING TO THE
 * DATABASE.
 *
 * This is the whole point of this route existing separately from
 * /api/resume/parse: that route calls upsertBaseResume, which repoints the
 * user's canonical is_base=true resume — the one Auto-Apply submits on their
 * behalf. Styling a CV in the builder must never silently change what
 * Auto-Apply would submit. So this route does exactly what
 * /api/resume/parse does up to the parse step, and then stops: it hands the
 * parsed (and sanitized) content back to the caller as JSON, and
 * createResumeAction (src/lib/resume-builder/actions.ts, "import_upload"
 * start state) is the only place that content is ever persisted — always
 * into a fresh `is_base: false` builder row, never the base resume.
 *
 * Shares parseResumeFile's degrade-gracefully behaviour with the onboarding
 * upload path: a file the parser can't make sense of still returns 200 with
 * confidence: "low" rather than failing, so a bad PDF lands the user in a
 * usable (if partial) editor rather than a hard error page. See
 * src/lib/resume/parse.ts's own comment for why that fallback exists.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Same bucket as /api/resume/parse — this is the same expensive operation
  // (heuristic parse, LLM fallback on a miss), just landing somewhere else.
  const quota = await consumeRateLimit(user.id, "resumeParse");
  if (!quota.allowed) return rateLimited(quota);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[resume-builder-import] malformed multipart body", err);
    return NextResponse.json(
      { error: "That upload didn't come through completely — try again." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Upload a PDF, DOCX, or plain text resume." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File is too large — 5MB max." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file appears to be empty." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let result;
  try {
    result = await parseResumeFile(buffer, file.type);
  } catch (err) {
    console.error("[resume-builder-import] could not read file", { type: file.type }, err);
    return NextResponse.json(
      { error: "Couldn't read that file. Try a different export, or start blank and paste the details in." },
      { status: 422 },
    );
  }

  let resume;
  try {
    resume = sanitizeStructuredResume(result.resume);
  } catch (err) {
    return internalError("resume-builder-import:sanitize", err);
  }

  return NextResponse.json({
    resume,
    confidence: result.confidence,
  });
}
