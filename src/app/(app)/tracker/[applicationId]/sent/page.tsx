import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { ResumeDocument } from "@/components/resume-builder/resume-document";
import { parseResumeSnapshot } from "@/lib/applications/resume-snapshot";
import { formatTrackerDate } from "@/lib/tracker/format-date";

export const metadata = { title: "What you sent — Talentrah" };

/**
 * The frozen copy of a resume or cover letter an application was sent with,
 * after the source resume has been deleted (migration 0094).
 *
 * WHY A ROUTE AND NOT JUST A LABEL ON THE CARD. The snapshot exists so the
 * user's application history survives them tidying up their drafts; a label
 * saying a copy was kept, with no way to read it, would keep the promise on
 * paper only. This is the page that makes the column load-bearing.
 *
 * READ-ONLY BY CONSTRUCTION. There is no resume row to write back to — the
 * whole point is that it is gone — so there is no editor, no save and no
 * "restore". Restoring a deleted resume as a new editable row is a real
 * feature request and deliberately not this one: it would need its own answer
 * to what happens to the application's link, and delete is documented to the
 * user as irreversible.
 *
 * SCOPED BY user_id, not just by application id. The application id is a uuid
 * in a URL, and RLS already scopes `applications` to its owner, but the filter
 * is written out rather than left implicit — this page renders a whole resume,
 * which is the most PII-dense thing the product holds.
 */
export default async function SentDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ applicationId: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  const { user } = await requireUser();
  const { applicationId } = await params;
  const { doc } = await searchParams;
  const isCoverLetter = doc === "cover-letter";

  const supabase = await createClient();
  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, resume_snapshot, cover_letter_snapshot, job_posting_id, manual_job_snapshot, job_postings(company_name, title)",
    )
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!application) notFound();

  const snapshot = parseResumeSnapshot(
    isCoverLetter ? application.cover_letter_snapshot : application.resume_snapshot,
  );
  if (!snapshot) notFound();

  const manual = application.manual_job_snapshot as { companyName?: string; title?: string } | null;
  const role = application.job_postings?.title ?? manual?.title ?? null;
  const company = application.job_postings?.company_name ?? manual?.companyName ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <EyebrowLabel>{isCoverLetter ? "Cover letter sent" : "Resume sent"}</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">{snapshot.title}</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          {[role, company].filter(Boolean).join(" · ") || "This application"}
        </p>
      </div>

      <div className="border-[1.5px] border-ink bg-rust-soft px-4 py-3 text-[13px] text-ink">
        The resume this was made from has been deleted. This is the copy saved
        when you deleted it
        {snapshot.capturedAt ? ` on ${formatTrackerDate(snapshot.capturedAt)}` : ""}, so your
        application record still shows what you actually sent. It can&rsquo;t be edited.
      </div>

      <div className="border-[1.5px] border-ink">
        <ResumeDocument resume={snapshot.content} />
      </div>

      <Link href="/tracker" className="min-h-10 text-[13.5px] font-semibold underline underline-offset-2">
        ← Back to Job Tracker
      </Link>
    </div>
  );
}
