import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { TailorForm } from "@/components/tailoring/tailor-form";

export const metadata = { title: "Tailor my resume — Talentrah" };

export default async function TailorPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const { user } = await requireUser();
  const { jobId } = await searchParams;
  const supabase = await createClient();

  const [{ data: job }, { data: baseResume }] = await Promise.all([
    jobId
      ? supabase.from("job_postings").select("id, title, description").eq("id", jobId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("resumes").select("id").eq("user_id", user.id).eq("is_base", true).maybeSingle(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <EyebrowLabel>Farah — tailor my resume</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">
          {job ? `Tailor your resume to "${job.title}"` : "Paste a job description"}
        </h1>
        <p className="mt-1 max-w-[600px] text-[14.5px] text-ink-soft">
          Farah reads the real requirements, shows what&apos;s matched and
          missing, and returns a tailored resume with an ATS score. Your
          first tailoring run (and first cover letter) are free.
        </p>
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
        <TailorForm jobId={job?.id} initialJdText={job?.description ?? ""} />
      )}
    </div>
  );
}
