import { requirePermission } from "@/lib/admin/require-admin";
import { feedbackQueue, type FeedbackStatus } from "@/lib/admin/moderation/queues";
import { decideFeedbackAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Feedback triage — Talentrah admin",
  robots: { index: false, follow: false },
};

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  idea: "Idea",
  other: "Other",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  in_review: "In review",
  resolved: "Resolved",
  declined: "Declined",
};

/**
 * What people have told us, and whether anyone has looked at it.
 *
 * 0054 built this table as a write-only mailbox and ended by naming its own
 * gap: feedback nobody reads is feedback nobody acts on. This is the read
 * path, and it is the only one — the table's SELECT privilege is still revoked
 * from every client role, so this page reaches it the same way the other three
 * queues reach their rows, through requirePermission("feedback") and the service role.
 *
 * THE AUTHOR IS NOT SHOWN, AND IS NOT FETCHED. See feedbackQueue(): `user_id`
 * is never selected, so there is no identity on this page to leak by accident.
 * An operator therefore cannot reply from here, which is a real limitation and
 * a deliberate one — contacting someone about what they wrote privately is a
 * decision nobody has made yet, and a screen that displayed the name would
 * have made it silently.
 *
 * Resolved and declined items drop out of the default view rather than being
 * deleted. Nothing here can delete feedback; the table has no DELETE path for
 * anyone but the service role, and an operator who could erase a complaint is
 * not a triager.
 */
export default async function FeedbackQueuePage() {
  const admin = await requirePermission("feedback");
  const queue = await feedbackQueue(["new", "in_review"]);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Feedback triage"
        title="What people have told us."
        blurb="Open items, newest first. Names are deliberately absent — this is a private mailbox, so there is no author shown and no way to reply from here. Declining needs a reason; resolving does not, but one helps the next person."
        adminLabel={admin.displayName || admin.email}
      />

      {queue.length === 0 ? (
        <QueueEmpty>
          Nothing open. Resolved and declined items stay in the table; they are
          simply not shown here.
        </QueueEmpty>
      ) : (
        <ul className="flex list-none flex-col gap-5 p-0">
          {queue.map((f) => (
            <li key={f.id}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <EyebrowLabel>
                    {CATEGORY_LABEL[f.category] ?? f.category}
                    {f.pagePath && ` · ${f.pagePath}`}
                  </EyebrowLabel>
                  <span className="text-[12.5px] text-ink-soft">
                    {new Date(f.createdAt).toLocaleDateString()}
                    {f.status !== "new" && ` · ${STATUS_LABEL[f.status]}`}
                  </span>
                </div>

                {/*
                  The person's own words, rendered as a quotation rather than
                  as body copy. `whitespace-pre-wrap` because people write in
                  paragraphs and a collapsed one reads as a different message.
                */}
                <blockquote className="m-0 border-l-2 border-line pl-4 font-display text-[16px] leading-relaxed whitespace-pre-wrap">
                  {f.message}
                </blockquote>

                {f.triagedByName && f.triagedAt && (
                  <p className="text-[13px] text-ink-soft">
                    Last moved by {f.triagedByName} on{" "}
                    {new Date(f.triagedAt).toLocaleDateString()}
                    {f.triageNote && ` — “${f.triageNote}”`}
                  </p>
                )}

                <DecisionForm
                  id={f.id}
                  action={decideFeedbackAction}
                  notePlaceholder="Note — required to decline, kept in the audit log"
                  options={[
                    { value: "in_review", label: "In review" },
                    { value: "resolved", label: "Resolved", variant: "primary" },
                    { value: "declined", label: "Decline", requiresNote: true },
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
