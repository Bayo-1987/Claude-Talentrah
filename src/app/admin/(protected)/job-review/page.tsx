import { requirePermission } from "@/lib/admin/require-admin";
import { pendingJobReviews } from "@/lib/admin/moderation/queues";
import { decideJobReviewAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, Card } from "@/components/ui";

export const metadata = {
  title: "Job review — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Path 3 (0118/0119): postings an employer asked an admin to individually
 * approve for public listing, when their organisation has no other route
 * there yet.
 *
 * OLDEST REQUEST FIRST — a fairness queue, not a severity one. See
 * `pendingJobReviews`'s own comment for why that is the defensible ordering
 * here, unlike the reports queue's worst-first ranking.
 *
 * APPROVING NEVER TOUCHES `organizations.verified`. It is stated on the page
 * as well as in the Server Action, because an admin scanning this list should
 * not have to open the migration to know that approving one posting does not
 * clear the organisation's whole backlog.
 */
export default async function JobReviewQueuePage() {
  const admin = await requirePermission("job_review");
  const queue = await pendingJobReviews();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Job review"
        title="Individual postings awaiting Path 3 approval."
        blurb="Oldest request first. Approving lists THIS posting only — it does not verify the organisation, and every other or future posting from the same org needs its own separate approval."
        adminLabel={admin.displayName || admin.email}
      />

      {queue.length === 0 ? (
        <QueueEmpty>No postings are waiting on an individual review.</QueueEmpty>
      ) : (
        <ul data-testid="job-review-queue" className="flex list-none flex-col gap-5 p-0">
          {queue.map((job) => (
            <li key={job.jobPostingId}>
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>{job.organizationName ?? job.companyName}</EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {job.title}
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">
                    {job.location ?? "No location given"} · requested{" "}
                    {new Date(job.requestedAt).toLocaleDateString()}
                    {job.organizationVerified && (
                      <>
                        {" "}
                        · <span className="text-amber">organisation is already verified</span>
                      </>
                    )}
                  </p>
                </div>

                <DecisionForm
                  id={job.jobPostingId}
                  action={decideJobReviewAction}
                  decisionName="decision"
                  noteName="note"
                  notePlaceholder="Note (required to reject, kept in the audit log)"
                  options={[
                    { value: "approved", label: "Approve this posting", variant: "primary" },
                    { value: "rejected", label: "Reject", requiresNote: true },
                  ]}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
