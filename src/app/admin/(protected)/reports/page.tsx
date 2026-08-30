import { requirePermission } from "@/lib/admin/require-admin";
import { reportedPostings, removedPostings } from "@/lib/admin/moderation/queues";
import { decideJobPostingAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Reported postings — Talentrah admin",
  robots: { index: false, follow: false },
};

const REASON_LABEL: Record<string, string> = {
  scam: "Scam",
  closed_but_listed: "Closed but listed",
  discriminatory: "Discriminatory",
  other: "Other",
};

/**
 * Postings people have reported, worst first.
 *
 * THE COUNT IS PEOPLE, NOT CLICKS, and the page says so. 0057's unique
 * constraint — one report per person per posting — is what makes that true,
 * and an operator acting on "12" needs to know it is not one angry person
 * twelve times. Without that sentence the number is an applause meter.
 *
 * Reporters are never named here. The reports table is write-only by design
 * (0057): a report is an accusation against a named company by a named user,
 * and the operator's job is to judge the posting, not the reporter. Only the
 * free-text details are surfaced, which is the part that carries evidence.
 */
export default async function ReportsQueuePage() {
  const admin = await requirePermission("reported_postings");
  const [queue, removed] = await Promise.all([reportedPostings(), removedPostings()]);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Reported postings"
        title="What people have flagged."
        blurb="Ranked by how many distinct people reported each posting — one report per person, so the number is people and not clicks. Removing hides it from the public; the owning organisation still sees it and the reason."
        adminLabel={admin.displayName || admin.email}
      />

      {queue.length === 0 ? (
        <QueueEmpty>No open reports. Removed postings drop out of this queue.</QueueEmpty>
      ) : (
        <ul className="flex list-none flex-col gap-5 p-0">
          {queue.map((p) => (
            <li key={p.jobPostingId}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <EyebrowLabel>{p.company}</EyebrowLabel>
                    <h2 className="font-display text-[20px] font-semibold leading-snug">
                      {p.title}
                    </h2>
                    <p className="text-[13.5px] text-ink-soft">
                      {p.sourceType === "external" ? "External listing" : "Posted on Talentrah"} ·{" "}
                      status {p.status} · latest report{" "}
                      {new Date(p.latestAt).toLocaleDateString()}
                    </p>
                    {p.externalUrl && (
                      <a
                        href={p.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="break-all text-[13.5px] underline"
                      >
                        {p.externalUrl}
                      </a>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    {/*
                      data-testid, not a class hook: the e2e suite asserts this
                      number means PEOPLE rather than clicks, and a locator
                      built on `font-display` would go quietly missing the next
                      time the type scale is touched — reported as "element not
                      found" rather than as a renamed class.
                    */}
                    <span
                      data-testid="report-count"
                      className="font-display text-[28px] leading-none"
                    >
                      {p.reportCount}
                    </span>
                    <span className="text-[12px] text-ink-soft">
                      {p.reportCount === 1 ? "person" : "people"}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {Object.entries(p.reasons).map(([reason, n]) => (
                    <span
                      key={reason}
                      className="border border-line px-2.5 py-1 text-[12.5px] text-ink-soft"
                    >
                      {REASON_LABEL[reason] ?? reason} · {n}
                    </span>
                  ))}
                </div>

                {p.details.length > 0 && (
                  <ul className="flex list-none flex-col gap-2 border-l-2 border-line p-0 pl-4">
                    {p.details.map((d, i) => (
                      <li key={i} className="font-display text-[14px] italic text-ink-soft">
                        “{d}”
                      </li>
                    ))}
                  </ul>
                )}

                <DecisionForm
                  id={p.jobPostingId}
                  action={decideJobPostingAction}
                  decisionName="action"
                  noteName="reason"
                  notePlaceholder="Reason — required either way, kept in the audit log"
                  /*
                    Remove only. A posting listed HERE is by definition not
                    removed — the query filters them out — so a Restore button
                    on this row could never succeed. It shipped in M2 and was
                    unreachable in both directions at once; restore now lives
                    where the removed postings actually are.
                  */
                  options={[
                    { value: "remove", label: "Remove from the board", variant: "primary" },
                  ]}
                />
              </BorderedCard>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <EyebrowLabel>Removed from the board</EyebrowLabel>
        <p className="max-w-[640px] font-display text-[14.5px] italic text-ink-soft">
          Restoring puts a posting back as <strong className="not-italic">closed</strong>, never
          open. Restoring says the removal was wrong; it does not say the job is live. An
          external posting reopens on the next ingest run only if its source still lists it, and
          an internal one is the employer&apos;s to reopen.
        </p>
        {removed.length === 0 ? (
          <BorderedCard className="p-5">
            <p className="font-display text-[15px] italic text-ink-soft">
              Nothing is removed.
            </p>
          </BorderedCard>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {removed.map((p) => (
              <li key={p.jobPostingId}>
                <BorderedCard className="flex flex-col gap-3 p-5">
                  <div className="flex flex-col gap-1.5">
                    <EyebrowLabel>{p.company}</EyebrowLabel>
                    <h3 className="font-display text-[19px] font-semibold leading-snug">
                      {p.title}
                    </h3>
                    <p className="text-[13.5px] text-ink-soft">
                      {p.sourceType === "external" ? "External listing" : "Posted on Talentrah"}
                      {p.removedAt && ` · removed ${new Date(p.removedAt).toLocaleDateString()}`}
                      {p.removedByName ? ` by ${p.removedByName}` : " · remover not recorded"}
                    </p>
                    {p.removalReason && (
                      <p className="font-display text-[14px] italic text-ink-soft">
                        “{p.removalReason}”
                      </p>
                    )}
                  </div>

                  <DecisionForm
                    id={p.jobPostingId}
                    action={decideJobPostingAction}
                    decisionName="action"
                    noteName="reason"
                    notePlaceholder="Why is this being restored? Required, and kept in the audit log"
                    options={[{ value: "restore", label: "Restore to closed", variant: "primary" }]}
                  />
                </BorderedCard>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}
