import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseResumeFile } from "@/lib/resume/parse";

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

  const formData = await request.formData();
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
    return NextResponse.json(
      { error: "File is too large — 5MB max." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let result;
  try {
    result = await parseResumeFile(buffer, file.type);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't read that file." },
      { status: 422 },
    );
  }

  const { data: resume, error: insertError } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      is_base: true,
      title: "My resume",
      source: "uploaded",
      structured_content: JSON.parse(JSON.stringify(result.resume)),
    })
    .select("id")
    .single();

  if (insertError || !resume) {
    return NextResponse.json(
      { error: "Couldn't save your resume — try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    resumeId: resume.id,
    resume: result.resume,
    confidence: result.confidence,
  });
}
