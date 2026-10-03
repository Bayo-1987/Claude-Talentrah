import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getQuotaState } from "@/lib/auto-apply/queue";
import { AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import type { QueueItem } from "@/components/jobs/auto-apply-queue-item";
import { AutoApplyQueueList } from "@/components/jobs/auto-apply-queue-list";
import { AutoApplyQuotaLine } from "@/components/jobs/auto-apply-quota-line";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { isWellFormedExplanation } from "@/lib/auto-apply/queue-read";
import { fetchListablePending } from "@/lib/auto-apply/listable-pending";
import { displayMatchScore } from "@/lib/match-tier";

export const metadata = { title: "Auto-Apply — Talentrah" };

const STATUS_LABEL: Record<string, string> = {
  submitted: "Applied for you",
  handed_off: "Sent you to the posting",
  dismissed: "You passed",
  expired: "Job closed first",
};

export default async function AutoApplyPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  // Read through the USER's client: auto_apply_queue is owner-readable by
  // policy (0033), so if that policy ever regresses this page shows nothing
  // rather than someone else's queue.
  const [{ data: rows }, { data: settings }, quota] = await Promise.all([
    supabase
      .from("auto_apply_queue")
      .select(
        "id, job_posting_id, status, match_score, tier, source_type, queued_at, decided_at, credits_spent, job_postings(title, company_name, location, status)",
      )
      .eq("user_id", user.id)
      .order("queued_at", { ascending: false })
      .limit(60),
    supabase.from("auto_apply_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
    getQuotaState(user.id),
  ]);

  const all = rows ?? [];

  /*
   * `explanation` is read LIVE from `match_scores`, not carried on the queue
   * row itself — the same reasoning as the confirm-time gate (0034/0164)
   * re-reading the live score rather than trusting the row's own snapshot.
   * `auto_apply_queue.match_score`/`tier` are a deliberate snapshot of what
   * justified queuing the item (the table's own schema comment); "how thin
   * the underlying skill overlap is" is a property of the CURRENT match, not
   * a fact to freeze at queue time. Without this, the review queue — the
   * literal screen a user confirms a match from — never had a way to show
   * MatchTierBadge's thin-match qualifier or #411's cap/re-tier at all,
   * since both depend entirely on `explanation` being passed in.
   *
   * A missing `match_scores` row (confirmed to exist for a small number of
   * real queue rows in production) resolves to `null` here, same as
   * `job-card.tsx`'s own caller does when there's nothing to explain.
   *
   * A malformed explanation ALSO resolves to `null`, deliberately, rather
   * than being passed through. `explanation jsonb not null default '{}'`
   * (0000_baseline_schema.sql) means a row written without an explicit
   * explanation — every real one computeAndStoreMatchScores writes always
   * has one, but a fixture or a future write path might not — stores a
   * literal `{}`. `MatchTierBadge` does `explanation.matchedSkills.length`
   * unconditionally once `explanation` is truthy, so a bare `{}` (present
   * but shapeless) would throw, not silently render as "not thin" — worse
   * than the missing-row case, which was already handled safely.
   */
  /*
   * What the page may LIST (send-506, A1): only rows something CURRENT vouches for, by the one rule shared with the
   * /jobs banner (fetchListablePending -> isListableQueueRow). The score shown is the LIVE one, never the snapshot.
   * Rows that fail stay `pending` in the table (this is a read) and the confirm-time gate still refuses them.
   */
  const listable = await fetchListablePending(supabase, user.id);
  const pending: QueueItem[] = listable.map(({ row: r, live }) => ({
    id: r.id,
    jobTitle: r.job_postings?.title ?? "Untitled role",
    companyName: r.job_postings?.company_name ?? "Unknown company",
    location: r.job_postings?.location ?? null,
    matchScore: live.score,
    sourceType: r.source_type,
    explanation: isWellFormedExplanation(live.explanation) ? live.explanation : null,
  }));
  const history = all.filter((r) => r.status !== "pending");

  return (
    <div className="flex max-w-[820px] flex-col gap-7">
      <div>
        <EyebrowLabel>Auto-Apply</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          Review queue
        </h1>
        <p className="mt-2 max-w-[62ch] font-body text-[14.5px] text-ink-soft">
          Roles scoring {AUTO_APPLY_MIN_SCORE}%+ against your resume land here. Nothing is ever
          submitted until you confirm it.
        </p>
      </div>

      {!settings?.enabled && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          Auto-Apply is off, so nothing new is being queued.{" "}
          <Link href="/jobs" className="font-semibold text-rust underline underline-offset-2">
            Turn it on from the job feed
          </Link>
          .
        </p>
      )}

      <BorderedCard className="p-4">
        <AutoApplyQuotaLine quota={quota} />
      </BorderedCard>

      <AutoApplyQueueList
        items={pending}
        // The button names the price only once confirming will actually charge (free allowance used up, no
        // covering Pass) — the same two flags the line above reads.
        confirmCostCredits={
          quota.nextSubmissionCostsCredits && !quota.nextSubmissionCovered ? CREDIT_COSTS.autoApplySubmission : null
        }
      />

      {history.length > 0 && (
        <section>
          <EyebrowLabel>Activity log</EyebrowLabel>
          <p className="mt-1.5 font-body text-[13px] text-ink-soft">
            Every decision Auto-Apply made or you made, and what it cost.
          </p>
          <div className="mt-3 flex flex-col">
            {history.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5"
              >
                <span className="font-body text-[13.5px] text-ink">
                  <span className="font-semibold">{STATUS_LABEL[r.status] ?? r.status}</span> —{" "}
                  {r.job_postings?.title ?? "Untitled role"} at{" "}
                  {r.job_postings?.company_name ?? "Unknown company"}
                </span>
                <span className="font-body text-[12.5px] text-ink-soft">
                  {displayMatchScore(r.match_score)}% ·{" "}
                  {r.decided_at ? formatRelativeTime(r.decided_at) : formatRelativeTime(r.queued_at)}
                  {r.credits_spent > 0 ? ` · ${r.credits_spent} credits` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
