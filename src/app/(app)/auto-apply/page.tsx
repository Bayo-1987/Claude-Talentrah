import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getQuotaState } from "@/lib/auto-apply/queue";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MIN_SCORE,
} from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { AutoApplyQueueItem, type QueueItem } from "@/components/jobs/auto-apply-queue-item";
import { formatRelativeTime } from "@/lib/format-relative-time";

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
        "id, status, match_score, tier, source_type, queued_at, decided_at, credits_spent, job_postings(title, company_name, location)",
      )
      .eq("user_id", user.id)
      .order("queued_at", { ascending: false })
      .limit(60),
    supabase.from("auto_apply_settings").select("enabled").eq("user_id", user.id).maybeSingle(),
    getQuotaState(user.id),
  ]);

  const all = rows ?? [];
  const pending: QueueItem[] = all
    .filter((r) => r.status === "pending")
    .map((r) => ({
      id: r.id,
      jobTitle: r.job_postings?.title ?? "Untitled role",
      companyName: r.job_postings?.company_name ?? "Unknown company",
      location: r.job_postings?.location ?? null,
      matchScore: r.match_score,
      sourceType: r.source_type,
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
        <p className="font-body text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{quota.dailyRemaining}</span> of{" "}
          {AUTO_APPLY_DAILY_SUBMIT_CAP} submissions left today ·{" "}
          <span className="font-semibold text-ink">{quota.freeRemaining}</span> of{" "}
          {AUTO_APPLY_FREE_PER_WEEK} free this week
          {quota.nextSubmissionCostsCredits
            ? quota.nextSubmissionCovered
              ? " · next one is included with your Pass"
              : ` · next one costs ${CREDIT_COSTS.autoApplySubmission} credits`
            : ""}
        </p>
      </BorderedCard>

      <section className="flex flex-col gap-3.5">
        {pending.length === 0 ? (
          <BorderedCard className="p-8 text-center">
            <p className="font-display text-[19px] font-medium text-ink">Nothing waiting</p>
            <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
              Auto-Apply only queues Excellent matches, so an empty queue usually means there
              aren&apos;t any right now — not that it isn&apos;t working.
            </p>
          </BorderedCard>
        ) : (
          pending.map((item) => <AutoApplyQueueItem key={item.id} item={item} />)
        )}
      </section>

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
                  {r.match_score}% ·{" "}
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
