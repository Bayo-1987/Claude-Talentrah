import { JobPostingForm, type JobFormValues } from "@/components/employer/job-posting-form";
import { defaultSalaryCurrency } from "@/lib/employer/salary-input";

/**
 * QA-only, same convention as `/dev/resume-editor-fixture`: reached by URL,
 * outside the `(app)` group (no masthead, no auth), no database. It mounts the
 * REAL `JobPostingForm` — the one the post-a-job and edit-a-job pages render —
 * so `e2e/post-job-form-layout.spec.ts` can drive the form's layout, salary
 * currency select and job-description editor accessibility in a real browser
 * without an employer account.
 *
 *   ?mode=create (default)   the Create page's wiring: staging picker under the
 *                            assessment checkbox, currency defaulted from
 *                            `?country=` (a profiles.country value) through the
 *                            same `defaultSalaryCurrency` the page uses.
 *   ?mode=edit               the Edit page's wiring: a saved assessment with two
 *                            exercise files, a stored GBP salary.
 *
 * Saving does nothing (the action below only returns); no file is uploaded.
 */
async function discardAction() {
  "use server";
  return null;
}

const EDIT_INITIAL: JobFormValues = {
  title: "Backend Engineer (Node.js)",
  location: "London, United Kingdom",
  description: "We are hiring a backend engineer to build payment APIs and mentor the team.",
  workType: "hybrid",
  employmentType: "full_time",
  seniority: "mid",
  yearsExperienceMin: 3,
  expiresAt: null,
  salaryMin: 50000,
  salaryMax: 70000,
  salaryCurrency: "GBP",
  salaryUnit: "year",
  skills: [],
  assessment: {
    title: "Take-home SQL exercise",
    instructions: "Write three queries against the attached schema.",
    exerciseLink: null,
    required: true,
  },
};

const EDIT_FILES = [
  { id: "fixture-file-1", url: null, originalFilename: "brief.pdf", byteSize: 20480 },
  { id: "fixture-file-2", url: null, originalFilename: "schema.txt", byteSize: 1024 },
];

export default async function JobPostingFormFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; country?: string }>;
}) {
  const { mode, country } = await searchParams;
  const editing = mode === "edit";

  return (
    <div className="mx-auto max-w-[820px] bg-paper px-6 py-8">
      <JobPostingForm
        action={discardAction}
        submitLabel={editing ? "Save changes" : "Publish job"}
        pendingLabel="Saving…"
        defaultSalaryCurrency={defaultSalaryCurrency(country)}
        {...(editing
          ? {
              initial: EDIT_INITIAL,
              assessmentEditContext: { jobId: "fixture-job", userId: "fixture-user" },
              assessmentSavedFiles: EDIT_FILES,
            }
          : { assessmentCreateContext: { userId: "fixture-user" } })}
      />
    </div>
  );
}
