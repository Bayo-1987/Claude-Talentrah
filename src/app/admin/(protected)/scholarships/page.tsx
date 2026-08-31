import { requirePermission } from "@/lib/admin/require-admin";
import { pendingScholarships } from "@/lib/admin/moderation/queues";
import { decideScholarshipAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";

export const metadata = {
  title: "Scholarship review — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * The scholarship queue, with real approve/reject.
 *
 * This replaces the read-only viewer that lived on /admin/scholarships/new
 * behind a typed-in shared secret. That page kept its submission form and lost
 * the password field: an operator who reached it is already authenticated by
 * session, and asking for a secret as well would be theatre.
 *
 * Approving publishes to the public catalog — `organizations.verified`-style
 * gating does not apply here; `moderation_status = 'verified'` IS the gate. So
 * the decision is stated in those terms on the page rather than as an abstract
 * status change.
 */
export default async function ScholarshipQueuePage() {
  const admin = await requirePermission("scholarships");
  const queue = await pendingScholarships();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Scholarship review"
        title="Listings waiting to be published."
        blurb="Approving puts a listing in the public catalog. Rejecting keeps it out and records why. Either way the decision is recorded against your account."
        adminLabel={admin.displayName || admin.email}
        newHref="/admin/scholarships/new"
        newLabel="Add one by hand"
      />

      {queue.length === 0 ? (
        <QueueEmpty>Nothing pending. Newly ingested listings land here.</QueueEmpty>
      ) : (
        <ul className="flex list-none flex-col gap-5 p-0">
          {queue.map((s) => (
            <li key={s.id}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>{s.provider}</EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {s.programName}
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">
                    Deadline{" "}
                    {s.deadline ? new Date(s.deadline).toLocaleDateString() : "not stated"}
                    {s.lastCheckedAt &&
                      ` · last checked ${new Date(s.lastCheckedAt).toLocaleDateString()}`}
                  </p>
                  {/*
                    The official URL is the single most useful thing for a
                    reviewer — the decision is mostly "is this real". rel and
                    target are set because it points off-site to an unvetted
                    destination, which is exactly what is being vetted.
                  */}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all text-[13.5px] underline"
                  >
                    {s.url}
                  </a>
                </div>

                <DecisionForm
                  id={s.id}
                  action={decideScholarshipAction}
                  notePlaceholder="Reason — required to reject, kept in the audit log"
                  options={[
                    { value: "verified", label: "Approve & publish", variant: "primary" },
                    { value: "rejected", label: "Reject", requiresNote: true },
                  ]}
                />
              </BorderedCard>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
