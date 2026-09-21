import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { updateJobAction } from "@/lib/employer/actions";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { JobPostingForm } from "@/components/employer/job-posting-form";
import { JobBannerUpload } from "@/components/employer/job-banner-upload";
import { bannerPublicUrl } from "@/lib/employer/banner";
import { AssessmentExerciseUpload, type AssessmentExerciseFile } from "@/components/employer/assessment-exercise-upload";
import { assessmentExerciseFileUrl } from "@/lib/employer/assessment-document";

export const metadata = { title: "Edit job — Talentrah" };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization, userId } = await requireEmployer();
  const supabase = await createClient();

  // Scoped to the org as well as the id. RLS would already stop a write to
  // someone else's posting, but reading one and rendering it into an edit form
  // would leak its contents before the write was ever attempted.
  const { data: job } = await supabase
    .from("job_postings")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!job) notFound();

  const { data: screeningQuestions } = await supabase
    .from("job_posting_screening_questions")
    .select("id, question_text, question_type, required, expected_yes_no, min_value, screening_mode")
    .eq("job_posting_id", id)
    .order("sort_order", { ascending: true });

  const { data: assessment } = await supabase
    .from("job_posting_assessments")
    .select("id, title, instructions, exercise_link, required")
    .eq("job_posting_id", id)
    .maybeSingle();

  // send-364 — up to MAX_ASSESSMENT_FILES rows now, not one column. Only
  // queried when an assessment actually exists; a posting with none has no
  // job_posting_assessment_id to look up files by.
  const { data: assessmentFileRows } = assessment
    ? await supabase
        .from("job_posting_assessment_files")
        .select("id, file_path, original_filename, byte_size")
        .eq("job_posting_assessment_id", assessment.id)
        .order("created_at", { ascending: true })
    : { data: null };

  const assessmentFiles: AssessmentExerciseFile[] = (assessmentFileRows ?? []).map((row) => ({
    id: row.id,
    url: assessmentExerciseFileUrl({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      filePath: row.file_path,
      // organization.id, not job.organization_id: the initial job fetch
      // above is already scoped `.eq("organization_id", organization.id)`,
      // so the two are proven equal and this one is non-nullable.
      organizationId: organization.id,
      jobPostingId: job.id,
    }),
    originalFilename: row.original_filename,
    byteSize: row.byte_size,
  }));

  // `structured_jd` is a loose `Json` column — a legacy row from before this
  // field existed defaults to `{}` with no `skills` key at all, which reads
  // the same as "no skills chosen yet" and lets JobPostingForm's own
  // mount-time seed (extractStructuredJd against the stored description) take
  // over, same as a brand-new blank form.
  const structuredJd = job.structured_jd as { skills?: string[] } | null;

  return (
    <div className="max-w-[820px]">
      <Link
        href="/employer/jobs"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Jobs Posted
      </Link>
      <div className="mt-4">
        <EyebrowLabel>Editing</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          {job.title}
        </h1>
      </div>
      {/*
        Above the form because it is the one field that is not part of the
        posting's text, and because an employer arriving to add a banner should
        not have to scroll past every other field to find it.

        This preview does NOT apply the public visibility gate: it is the
        owner's own edit screen and showing them their own artwork is the
        point. Whether the PUBLIC page renders it is a different question,
        answered on the detail page and explained in the notice inside this
        card when the answer is currently no.
      */}
      <div className="mt-6">
        <JobBannerUpload
          jobId={job.id}
          organizationVerified={organization.verified}
          currentBannerUrl={bannerPublicUrl({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
            bannerPath: job.banner_path,
            organizationId: job.organization_id,
          })}
        />
      </div>
      <div className="mt-6">
        <JobPostingForm
          action={updateJobAction.bind(null, job.id)}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          assessmentEditContext={{ jobId: job.id, userId }}
          initial={{
            title: job.title,
            location: job.location ?? "",
            description: job.description,
            workType: job.work_type,
            employmentType: job.employment_type,
            seniority: job.seniority,
            yearsExperienceMin: job.years_experience_min,
            expiresAt: job.expires_at,
            salaryMin: job.salary_min,
            salaryMax: job.salary_max,
            salaryCurrency: job.salary_currency,
            salaryUnit: job.salary_unit,
            skills: structuredJd?.skills ?? [],
            screeningQuestions: (screeningQuestions ?? []).map((q) => ({
              id: q.id,
              questionText: q.question_text,
              questionType: q.question_type as "yes_no" | "min_number" | "free_text",
              required: q.required,
              expectedYesNo: q.expected_yes_no,
              minValue: q.min_value,
              screeningMode: q.screening_mode as "self" | "farah",
            })),
            assessment: assessment
              ? {
                  title: assessment.title,
                  instructions: assessment.instructions,
                  exerciseLink: assessment.exercise_link,
                  required: assessment.required,
                }
              : null,
          }}
        />
      </div>
      {/*
        A separate card, same reason JobBannerUpload is one above rather
        than living inside JobPostingForm's own <form>: a File upload
        can't be threaded through a hidden form field the way title/
        instructions/link/required are, and this needs job.id to build its
        storage path from — see AssessmentExerciseUpload's own header.
      */}
      {assessment && (
        <BorderedCard className="mt-6 flex flex-col gap-3 p-6">
          <EyebrowLabel>Assessment exercise files</EyebrowLabel>
          <AssessmentExerciseUpload jobId={job.id} hasAssessment files={assessmentFiles} />
        </BorderedCard>
      )}
    </div>
  );
}
