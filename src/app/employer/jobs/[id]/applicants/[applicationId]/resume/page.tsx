import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { TemplateRenderer } from "@/components/resume-builder/templates";
import { EmployerPrintButton } from "@/components/employer/employer-print-button";
import type { StructuredResume } from "@/lib/resume/types";

export const metadata = { title: "Applicant resume — Talentrah" };

/**
 * Reuses the seeker's own rendering path exactly — `TemplateRenderer` +
 * `structured_content`, the same two things `resume-document.tsx`/the
 * resume builder editor already resolve via `resumes.template_id ->
 * resume_templates.slug`. No second rendering mechanism, per 0125's own
 * scope.
 *
 * `employer_view_resume` (0125) is the ONLY door here: it is keyed on
 * `application_id`, not a resume id, and returns nothing at all — not an
 * error — for an application whose job posting isn't owned by an
 * organisation the caller belongs to. `requireEmployer()` above only
 * ensures the caller has SOME organisation; the RPC's own membership check
 * is the real, independent gate, the same two-layer shape the applicants
 * list page uses.
 */
export default async function ApplicantResumePage({
  params,
}: {
  params: Promise<{ id: string; applicationId: string }>;
}) {
  const { id, applicationId } = await params;
  await requireEmployer();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("employer_view_resume", { p_application_id: applicationId })
    .maybeSingle();

  if (error || !data || !data.structured_content) notFound();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/employer/jobs/${id}/applicants`}
          className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
        >
          ← Applicants
        </Link>
        <EmployerPrintButton />
      </div>
      <div className="border-[1.5px] border-ink">
        <TemplateRenderer
          slug={data.template_slug}
          resume={data.structured_content as unknown as StructuredResume}
        />
      </div>
    </div>
  );
}
