import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { TemplateRenderer } from "@/components/resume-builder/templates";
import { PrintButton } from "@/components/resume-builder/print-button";

export const metadata = { title: "Preview resume — Talentrah" };

export default async function ResumePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ resumeId?: string }>;
}) {
  const { user } = await requireUser();
  const { resumeId } = await searchParams;
  if (!resumeId) redirect("/resume-builder");

  const supabase = await createClient();
  /*
   * `template_id` and the joined `slug` are the point of this select. Before
   * the template library existed this page rendered `ResumeDocument` for every
   * resume and did not read `template_id` at all — so picking a template,
   * including paying credits to unlock a premium one, changed nothing about
   * what came out. The join is an inner-style embed on a nullable FK, so a
   * resume with no template still returns a row with `resume_templates: null`.
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/resume-builder/edit?resumeId=${resume.id}`}
          className="text-[13.5px] font-semibold underline underline-offset-2"
        >
          ← Back to edit
        </Link>
        <PrintButton />
      </div>
      <div className="border-[1.5px] border-ink print:border-none">
        {/* Falls back to clean-professional for a null template or an
            unmapped slug — see the registry for why that is a fallback and
            not a throw. */}
        <TemplateRenderer slug={resume.resume_templates?.slug} resume={content} />
      </div>
    </div>
  );
}
