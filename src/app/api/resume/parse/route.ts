import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseResumeFile } from "@/lib/resume/parse";
import { upsertBaseResume } from "@/lib/resume/upsert-base-resume";
import { internalError } from "@/lib/api/admin-auth";
import { consumeRateLimit, rateLimited } from "@/lib/api/rate-limit";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Parsing falls back to an LLM extraction pass when the heuristic parser
  // can't make sense of a file, so an upload loop is a real cost. Rate-limited
  // per user; the counter is atomic in Postgres so concurrent uploads can't
  // all read the same count and all pass. See migration 0038.
  const quota = await consumeRateLimit(user.id, "resumeParse");
  if (!quota.allowed) return rateLimited(quota);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    /*
     * Was unguarded. `request.formData()` REJECTS on a malformed or truncated
     * multipart body — a dropped mobile connection mid-upload is the ordinary
     * way to produce one, which is exactly the network this app targets. An
     * unhandled rejection here surfaced as a framework 500 with no log line,
     * indistinguishable from a real server fault.
     */
    console.error("[resume-parse] malformed multipart body", err);
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
    /*
     * 422 with a FIXED message. This used to return `err.message`, which for
     * the PDF path is whatever pdf-parse/pdfjs threw — during the production
     * outage that was a raw `DOMMatrix is not defined`, shown to the user as
     * if it were advice about their file. Nothing a reader can act on belongs
     * in a parse failure; the detail goes to the log.
     */
    console.error("[resume-parse] could not read file", { type: file.type }, err);
    return NextResponse.json(
      { error: "Couldn't read that file. Try a different export, or paste the text instead." },
      { status: 422 },
    );
  }

  let resumeId: string;
  try {
    // Replaces any existing base resume in place — see upsert-base-resume.ts
    // for why this can't be a plain insert (QA audit bug #1).
    const resume = await upsertBaseResume(supabase, user.id, result.resume, "uploaded");
    resumeId = resume.id;
  } catch (err) {
    return internalError("resume-parse:save", err);
  }

  return NextResponse.json({
    resumeId,
    resume: result.resume,
    confidence: result.confidence,
  });
}
