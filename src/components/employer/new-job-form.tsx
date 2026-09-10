"use client";

import { useState } from "react";
import { JobImportPanel } from "./job-import-panel";
import { JobPostingForm, type JobFormValues } from "./job-posting-form";
import type { EmployerActionState } from "@/lib/employer/actions";
import type { ExtractedJobFields } from "@/lib/employer/job-import/types";

/** ExtractedJobFields -> JobFormValues. Purely a shape adapter: every field
 * ExtractedJobFields doesn't carry (yearsExperienceMin, expiresAt — neither
 * is something a job posting's own text reliably states as a fact, as
 * opposed to a policy the employer sets) stays at its "nothing chosen yet"
 * value, same as a hand-opened blank form. */
function toFormValues(fields: ExtractedJobFields): JobFormValues {
  return {
    title: fields.title ?? "",
    location: fields.location ?? "",
    description: fields.description ?? "",
    workType: fields.workType,
    employmentType: fields.employmentType,
    seniority: fields.seniority,
    yearsExperienceMin: null,
    expiresAt: null,
    salaryMin: fields.salaryMin,
    salaryMax: fields.salaryMax,
    salaryCurrency: fields.salaryCurrency,
    salaryUnit: fields.salaryUnit,
  };
}

/**
 * Wraps JobPostingForm with the "Import from URL" affordance (send-136),
 * kept as a thin client wrapper around the existing form rather than changes
 * inside JobPostingForm itself — that component is shared with the Edit
 * page (src/app/employer/jobs/[id]/edit/page.tsx), which has no import
 * affordance and shouldn't gain one implicitly.
 *
 * `formKey` exists because JobPostingForm's fields are UNCONTROLLED
 * (`defaultValue`, not `value` — see that component). React only applies
 * `defaultValue` at mount, so simply updating the `initial` prop after a
 * successful import would not change anything already on screen. Remounting
 * the form (a fresh `key`) is what actually gets a new default value into
 * each input; it also has the side benefit of discarding any hand-typed text
 * from before the import, which is the right behaviour here — an import is
 * "start over from this page's data", not "merge with whatever I already
 * typed".
 */
export function NewJobForm({
  action,
  submitLabel,
  pendingLabel,
  unverifiedNotice,
}: {
  action: (state: EmployerActionState, form: FormData) => Promise<EmployerActionState>;
  submitLabel: string;
  pendingLabel: string;
  unverifiedNotice?: string;
}) {
  const [initial, setInitial] = useState<JobFormValues | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);

  function handleImported(fields: ExtractedJobFields) {
    setInitial(toFormValues(fields));
    setFormKey((key) => key + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <JobImportPanel onImported={handleImported} />
      <JobPostingForm
        key={formKey}
        action={action}
        submitLabel={submitLabel}
        pendingLabel={pendingLabel}
        unverifiedNotice={unverifiedNotice}
        initial={initial}
      />
    </div>
  );
}
