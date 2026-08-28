import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { EyebrowLabel } from "@/components/ui";
import { ResumeUpload } from "@/components/onboarding/resume-upload";
import { hasVisibleName, visibleName } from "@/lib/profile/name";

export const metadata = { title: "Welcome — Talentrah" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = safeRedirectTo(rawNext, "/jobs");

  const { user, profile } = await requireUser();

  /*
   * ONBOARDING IS FOR PEOPLE WHO HAVE NOT ONBOARDED.
   *
   * Nothing here checked that, so anyone routed to /onboarding saw the upload
   * prompt whether or not they already had a resume. The visible case is OAuth:
   * signing in again with Google or LinkedIn in a fresh session sends a
   * returning user back through "upload your resume" as though the account
   * were new, on the screen whose whole job is to make the product feel like
   * it knows you.
   *
   * The check is a base resume, not a profile flag, because a base resume is
   * the thing onboarding exists to produce — a flag would be a second source
   * of truth that can disagree with it.
   *
   * REDIRECT ONLY ON A POSITIVE ANSWER, and the asymmetry is deliberate. If
   * this query errors we render the upload, because the two mistakes are not
   * equal: showing the prompt to someone who has a resume costs them one
   * click, while redirecting someone who has none strands them at /jobs with
   * no resume and no route back to the only screen that uploads one. Same
   * reasoning the jobs feed applies to this table — an error is not an
   * absence.
   */
  const supabase = await createClient();
  const { data: baseResume, error: baseResumeError } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_base", true)
    .maybeSingle();

  if (!baseResumeError && baseResume) redirect(next);

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

      <ResumeUpload next={next} />
    </div>
  );
}
