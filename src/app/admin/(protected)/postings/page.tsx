import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { searchJobPostings } from "@/lib/admin/moderation/search";
import { decideJobPostingAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, Card, TextField, Button } from "@/components/ui";

export const metadata = {
  title: "Find a posting — Talentrah admin",
  robots: { index: false, follow: false },
};

/** Always fresh: a cached "browse" list would show postings someone already removed. */
export const dynamic = "force-dynamic";

/**
 * Reach ANY live posting by name and remove it — the gap `/admin/reports`
 * can't close, because that page's whole queue is built from an inner join
 * on job_posting_reports (see `reportedPostings()`'s own header): a posting
 * nobody has reported is structurally invisible there, no matter how
 * obviously it should come down.
 *
 * A SEPARATE PAGE, NOT A SECTION BOLTED ONTO /admin/reports. That page's own
 * header frames it as answering one question — "what are people
 * complaining about" — and `removedPostings()`'s header already explains why
 * a second, different question ("what have we taken down") got its own list
 * rather than being merged in: mixing two questions into one screen makes
 * whatever count or list sits at the top mean two things at once. "Find any
 * posting, reported or not" is a third, different question again, for a
 * genuinely different visit — an admin who was just tipped off about one
 * specific company's listing has no reason to also read through the reports
 * queue to reach it, and a reports page whose top were also a general
 * postings search would no longer be "what people are complaining about" at
 * a glance.
 *
 * NOT A QUEUE. It carries no count in the nav (see admin-nav.tsx) and
 * `queueCounts()` doesn't know about it — there is no "pending" state to
 * count, since a live posting nobody's flagged isn't waiting on anything.
 * This is a search tool, worked when an admin has a specific posting in
 * mind, not a worklist to clear.
 *
 * SAME REMOVAL PATH AS THE REPORTS QUEUE, on purpose: `decideJobPostingAction`
 * already holds the permission check and the removal precondition in the
 * one RPC (`admin_moderate_job_posting`), and it has no dependency on the
 * posting having any reports — it just takes an id. Reusing it here means
 * this page adds a second way to FIND a posting, not a second way to REMOVE
 * one.
 */
export default async function PostingsSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Same gate `decideJobPostingAction` itself already enforces — an admin who
  // could remove a reported posting can remove any posting, since removing
  // one has never depended on it having been reported.
  const admin = await requirePermission("reported_postings");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const results = await searchJobPostings(q);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Find a posting</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Reach any live posting, reported or not.</h1>
        <p className="max-w-[640px] text-[15px] text-ink-soft">
          Search by title, company name, or organisation. Removing works exactly like the reports
          queue — a reason is required and kept in the audit log, and the posting drops onto{" "}
          <Link href="/admin/reports" className="underline">
            the removed list
          </Link>{" "}
          on the reports page.
        </p>
        <p className="font-display text-[14px] italic text-ink-soft">
          Deciding as {admin.displayName || admin.email}.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <TextField
            id="postings-q"
            label="Title, company, or organisation"
            name="q"
            type="search"
            autoComplete="off"
            defaultValue={q}
            placeholder="e.g. Fatishcakes, or Frontend Engineer"
          />
        </div>
        <Button type="submit">Search</Button>
        {q && (
          <Link href="/admin/postings" className="text-[13.5px] underline">
            Clear
          </Link>
        )}
      </form>

      <p className="text-[14px] text-ink-soft">
        {q
          ? `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”${results.length >= 50 ? " (showing the first 50)" : ""}.`
          : `Most recently posted, newest first${results.length >= 50 ? " (showing the first 50)" : ""}. Search narrows this list.`}
      </p>

      {results.length === 0 ? (
        <QueueEmpty>
          {q ? "No live posting matches that search." : "There are no live postings."}
        </QueueEmpty>
      ) : (
        <ul data-testid="postings-search-results" className="flex list-none flex-col gap-4 p-0">
          {results.map((p) => (
            <li key={p.jobPostingId}>
              <Card className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>
                    {p.company}
                    {p.organizationName && p.organizationName !== p.company
                      ? ` (${p.organizationName})`
                      : ""}
                  </EyebrowLabel>
                  <h2 className="font-display text-[19px] font-semibold leading-snug">{p.title}</h2>
                  <p className="text-[13.5px] text-ink-soft">
                    {p.sourceType === "external" ? "External listing" : "Posted on Talentrah"} ·{" "}
                    status {p.status}
                    {p.location && ` · ${p.location}`} · posted{" "}
                    {new Date(p.postedAt).toLocaleDateString()}
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

                <DecisionForm
                  id={p.jobPostingId}
                  action={decideJobPostingAction}
                  decisionName="action"
                  noteName="reason"
                  notePlaceholder="Reason — required, kept in the audit log"
                  options={[{ value: "remove", label: "Remove from the board", variant: "primary" }]}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
