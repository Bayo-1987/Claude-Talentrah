import { requireUser } from "@/lib/auth/require-user";
import { EyebrowLabel } from "@/components/ui";
import { ResumeUpload } from "@/components/onboarding/resume-upload";

export const metadata = { title: "Welcome — Talentrah" };

export default async function OnboardingPage() {
  const { profile } = await requireUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Farah — your co-pilot</EyebrowLabel>
        <h1 className="font-display text-[30px] leading-tight">
          Ready to land your dream job, {profile.first_name}?
        </h1>
        <p className="text-[15px] italic text-ink-soft font-display">
          Apply for jobs with confidence by uploading your resume and letting
          me analyze and optimize it for the best match.
        </p>
      </div>

      <ResumeUpload />
    </div>
  );
}
