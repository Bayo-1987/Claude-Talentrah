import { requireUser } from "@/lib/auth/require-user";
import { EyebrowLabel } from "@/components/ui";
import { ResumeUpload } from "@/components/onboarding/resume-upload";
import { hasVisibleName, visibleName } from "@/lib/profile/name";

export const metadata = { title: "Welcome — Talentrah" };

export default async function OnboardingPage() {
  const { profile } = await requireUser();

  return (
    <div className="mx-auto flex min-h-screen max-w-[560px] flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Farah — your co-pilot</EyebrowLabel>
        {/*
          first_name is nullable and genuinely absent for a large share of
          real signups, so the name can't be interpolated unconditionally —
          it was rendering "Ready to land your dream job, ?" on the very
          first screen a new user sees.

          Dropping the address entirely rather than substituting a filler
          like "there": this is a headline, and "Ready to land your dream
          job, there?" reads worse than simply not using a name. The Farah
          panel's conversational copy still uses the "there" fallback, which
          suits it — a greeting in a chat panel wants an address, a headline
          doesn't.
        */}
        <h1 className="font-display text-[30px] leading-tight">
          {hasVisibleName(profile.first_name)
            ? `Ready to land your dream job, ${visibleName(profile.first_name)}?`
            : "Ready to land your dream job?"}
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
