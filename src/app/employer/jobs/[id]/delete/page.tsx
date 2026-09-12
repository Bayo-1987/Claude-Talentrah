import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { deleteJobAction } from "@/lib/employer/actions";
import { Card, Button, EyebrowLabel, buttonClasses } from "@/components/ui";

export const metadata = { title: "Delete job — Talentrah" };

/**
 * A dedicated confirmation page, not a browser `confirm()` popup and not a
 * bare button — the same reasoning `/employer/jobs/[id]/edit` already
 * follows for a different irreversible-adjacent action, and consistent with
 * `posted-job-row.tsx`'s own "no client JS needed" stance for this page's
 * other row actions: a real page, a real server action, zero client
 * JavaScript.
 *
 * CLOSED POSTINGS ONLY — see deleteJobAction / deleteJobPosting's own
 * headers for why. An open posting 404s here rather than showing a form that
 * would just be refused on submit, since a button that always errors is
 * worse than no button (the same principle posted-job-row.tsx states for
 * hiding Edit/Close on a removed posting).
 *
 * Scoped by id AND organization_id, the same out-of-scope guard
 * `[id]/edit` and `[id]/applicants` both already use — RLS's own SELECT
 * policy on `job_postings` is public, so this is what actually stops one
 * org's employer from even seeing another org's posting title here.
 */
export default async function DeleteJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization } = await requireEmployer();
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("job_postings")
    .select("id, title, status")
    .eq("id", id)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!job || job.status !== "closed") notFound();

  // The same RPC the applicants page reads from (0125) — a real count of who
  // would lose the link to this listing, not a re-derivation of
  // org_application_counts (0029), which is aggregate-only and can't answer
  // "how many for THIS job" without its own extra call.
  const { data: applicants } = await supabase.rpc("employer_job_applicants", {
    p_job_posting_id: id,
  });
  const applicationCount = applicants?.length ?? 0;

  return (
    <div className="max-w-[640px]">
      <Link
        href="/employer/jobs"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-coral"
      >
        ← Jobs Posted
      </Link>
      <div className="mt-4">
        <EyebrowLabel>Delete posting</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px] leading-[1.15] font-medium text-ink">
          Delete &quot;{job.title}&quot;?
        </h1>
      </div>

      <Card className="mt-6 flex flex-col gap-3 p-5">
        <p className="font-body text-[14px] text-ink">
          This permanently removes the posting. It cannot be undone or reopened —
          this is different from Close, which you can reverse any time.
        </p>
        {applicationCount > 0 && (
          <p className="font-body text-[14px] text-ink">
            {applicationCount} applicant{applicationCount === 1 ? "" : "s"} will lose the link to
            this listing.
          </p>
        )}
        <p className="font-body text-[13.5px] text-ink-soft">
          Their own Job Tracker keeps working either way — it already keeps a frozen
          copy of what they applied to, independent of this posting.
        </p>
      </Card>

      <div className="mt-6 flex items-center gap-3">
        <form action={deleteJobAction.bind(null, job.id)}>
          <Button type="submit" variant="primary">
            Delete permanently
          </Button>
        </form>
        <Link href="/employer/jobs" className={buttonClasses("secondary", "md", "no-underline")}>
          Cancel
        </Link>
      </div>
    </div>
  );
}
