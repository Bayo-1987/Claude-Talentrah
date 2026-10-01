import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { TailorForm } from "@/components/tailoring/tailor-form";
import { decodeHtmlEntities, stripMarkdownToPlainText } from "@/lib/jobs/extract-jd";
import { checkPassCoverage } from "@/lib/passes/entitlement";
import { tailoringIntro } from "@/lib/credits/price-labels";

export const metadata = { title: "Tailor my resume — Talentrah" };

export default async function TailorPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string; coverLetter?: string }>;
}) {
  const { user } = await requireUser();
  const { jobId, coverLetter } = await searchParams;
  const supabase = await createClient();

  const [{ data: rawJob }, { data: baseResume }, { data: profile }, coverage] = await Promise.all([
    jobId
      ? supabase.from("job_postings").select("id, title, description").eq("id", jobId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("resumes").select("id").eq("user_id", user.id).eq("is_base", true).maybeSingle(),
    supabase
      .from("profiles")
      .select("free_trial_tailoring_used, free_trial_cover_letter_used, credits_balance")
      .eq("id", user.id)
      .maybeSingle(),
    checkPassCoverage(user.id),
  ]);

  /*
   * What a run costs THIS account, so the button can say so and the intro never promises a free run that is
   * already spent. Mirrors checkTailoringAllowance (the real gate): a covering Pass first, then the two
   * one-time free runs, then credits. A missing profile row is treated as "no free run, no balance" — the
   * conservative reading, since the gate itself would throw on it.
   */
  const pricing = {
    tailoringFree: profile ? !profile.free_trial_tailoring_used : false,
    coverLetterFree: profile ? !profile.free_trial_cover_letter_used : false,
    passCovered: coverage.covered,
    balance: profile?.credits_balance ?? 0,
  };

  /*
   * Defensive decode, not a fix at the ingestion source: some already-stored
   * descriptions carry an undecoded HTML entity (traced live — "monitoring,
   * evaluation &amp; learning" rendering literally in the JD box below,
   * caused by extract-jd.ts's decodeHtmlEntities missing a doubly-escaped
   * ampersand, now fixed there for future ingestion). Existing rows aren't
   * backfilled by that fix, so this page — the one place the report was
   * about — decodes again at display time rather than leaving already-stored
   * postings showing the literal entity until they're re-ingested.
   */
  const job = rawJob
    ? { ...rawJob, title: decodeHtmlEntities(rawJob.title), description: decodeHtmlEntities(rawJob.description) }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <EyebrowLabel>Farah — tailor my resume</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">
          {job ? `Tailor your resume to "${job.title}"` : "Paste a job description"}
        </h1>
        <p className="mt-1 max-w-[600px] text-[14.5px] text-ink-soft">{tailoringIntro(pricing)}</p>
      </div>

      {!baseResume ? (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[14px] text-rust">
          You need a base resume first — upload one or build one in the{" "}
          <a href="/resume-builder" className="underline">
            Resume Builder
          </a>
          .
        </p>
      ) : (
        <TailorForm
          jobId={job?.id}
          // A <textarea> can't render markdown, and stripHtml (#262) can now
          // leave **bold**/- bullet syntax in `description` — stripped back
          // to plain text here rather than rendered, since editable JD text
          // is the one context where "rendered rich" was never the goal.
          initialJdText={job ? stripMarkdownToPlainText(job.description) : ""}
          defaultCoverLetter={coverLetter === "1" || coverLetter === "true"}
          pricing={pricing}
        />
      )}
    </div>
  );
}
