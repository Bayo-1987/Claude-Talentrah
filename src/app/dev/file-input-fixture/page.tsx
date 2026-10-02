"use client";

import { BannerCropPicker } from "@/components/employer/banner-crop-picker";
import { NewJobAssessmentFilesPicker } from "@/components/employer/new-job-assessment-files-picker";
import { EditJobAssessmentFilesPicker } from "@/components/employer/edit-job-assessment-files-picker";
import { AssessmentExerciseUpload } from "@/components/employer/assessment-exercise-upload";
import { ScreeningGateApply } from "@/components/jobs/screening-gate-apply";
import { ResumeUpload } from "@/components/onboarding/resume-upload";

/**
 * QA-only (same convention as /dev/resume-editor-fixture): reached by URL, no auth, no database. It mounts the six
 * real file-input components so e2e/file-input-pre-hydration.spec.ts can pick a file BEFORE hydration, on each one,
 * and check it is not lost (issue #591).
 */
export default function FileInputFixture() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <section id="banner"><BannerCropPicker hasStagedBanner={false} onCropped={async () => ({ ok: true })} /></section>
      <section id="new-job"><NewJobAssessmentFilesPicker userId="fixture-user" /></section>
      <section id="edit-job"><EditJobAssessmentFilesPicker userId="fixture-user" jobId="fixture-job" /></section>
      <section id="exercise"><AssessmentExerciseUpload jobId="fixture-job" files={[]} hasAssessment /></section>
      <section id="screening">
        <ScreeningGateApply
          jobId="fixture-job"
          countryState={"allowed" as never}
          questions={[]}
          assessment={{ title: "Exercise", instructions: "Do it.", exerciseFiles: [], exerciseLink: null, required: false }}
        />
      </section>
      <section id="resume"><ResumeUpload showSkip={false} /></section>
    </div>
  );
}
