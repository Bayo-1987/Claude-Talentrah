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
  /*
   * `template_id` and the joined `slug` are read here for the same reason
   * the old /resume-builder/preview page read them (now folded into this
   * page's live preview, Stage 3.1) — TemplateRenderer needs the slug to
   * render the right layout. Inner-style embed on a nullable FK, so a resume
   * with no template still returns a row with `resume_templates: null`.
   */
  const { data: resume } = await supabase
    .from("resumes")
    .select("id, title, structured_content, template_id, resume_templates(slug)")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .single();

  if (!resume) redirect("/resume-builder");

  const content = (resume.structured_content as StructuredResume | null) ?? EMPTY_RESUME;

  return (
    <ResumeEditor
      resumeId={resume.id}
      initialTitle={resume.title}
      initialContent={content}
      templateSlug={resume.resume_templates?.slug ?? null}
    />
  );
}
