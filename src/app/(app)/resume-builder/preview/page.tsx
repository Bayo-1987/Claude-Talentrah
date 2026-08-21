import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { ResumeDocument } from "@/components/resume-builder/resume-document";
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
  const { data: resume } = await supabase
    .from("resumes")
    .select("id, title, structured_content")
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
        <ResumeDocument resume={content} />
      </div>
    </div>
  );
}
