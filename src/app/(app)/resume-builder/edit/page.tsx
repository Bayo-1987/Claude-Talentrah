import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { ResumeEditor } from "@/components/resume-builder/resume-editor";

export const metadata = { title: "Edit resume — Talentrah" };

export default async function ResumeEditPage({
  searchParams,
}: {
  searchParams: Promise<{ resumeId?: string }>;
}) {
  const { user } = await requireUser();
  const { resumeId } = await searchParams;
  if (!resumeId) redirect("/resume-builder");

  const supabase = await createClient();
  const { data: resume } = await supabase
    .from("resumes")
    .select("id, title, structured_content")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single();

  if (!resume) redirect("/resume-builder");

  const content = (resume.structured_content as StructuredResume | null) ?? EMPTY_RESUME;

  return (
    <ResumeEditor resumeId={resume.id} initialTitle={resume.title} initialContent={content} />
  );
}
