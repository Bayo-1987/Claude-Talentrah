import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getReviewDetail } from "@/lib/talent-directory/review-queries";
import { releaseVerificationReviewClaimAction } from "@/lib/talent-directory/reviewer-actions";
import { Container, EyebrowLabel, BorderedCard, Button } from "@/components/ui";
import { DecideForm } from "./decide-form";

export const metadata = { title: "Review a verification — Talentrah" };

/**
 * What the reviewer actually sees (0141/0142's scope item 4): the SAME
 * structured resume material verification-runner.ts's AI grader consumes —
 * fetched through talent_verification_review_detail (0142/0143), gated on
 * this reviewer currently holding the claim. A stale link (claim released,
 * already decided, or never yours) resolves to null and this renders "not
 * available" rather than leaking anything.
 */
export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ verificationId: string }>;
}) {
  // requireUser() is the route guard — the actual entitlement check (does
  // this session currently hold the claim on this verification?) is
  // talent_verification_review_detail's own auth.uid() check (0142/0143),
  // so there's nothing else to do with the resolved user here.
  await requireUser();
  const { verificationId } = await params;
  const detail = await getReviewDetail(verificationId);

  async function release() {
    "use server";
    await releaseVerificationReviewClaimAction(verificationId);
  }

  if (!detail) {
    return (
      <Container className="flex max-w-[720px] flex-col gap-6 py-12">
        <EyebrowLabel>Talent Directory</EyebrowLabel>
        <h1 className="font-display text-[28px] font-semibold">Not available</h1>
        <p className="text-[14.5px] text-ink-soft">
          This submission isn&apos;t claimed by you, or it&apos;s already been decided.
        </p>
        <Link href="/mentorship/reviews" className="text-[13.5px] text-rust">
          Back to the queue ↗
        </Link>
      </Container>
    );
  }

  const candidateName = [detail.candidateFirstName, detail.candidateLastName].filter(Boolean).join(" ") || "This candidate";

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Reviewing {candidateName}</h1>
      <p className="text-[13.5px] text-ink-soft">
        {detail.targetRole ?? "No target role stated"}
        {detail.targetIndustry ? ` · ${detail.targetIndustry}` : ""} · requested{" "}
        {new Date(detail.requestedAt).toLocaleString()}
      </p>

      <BorderedCard className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-[18px] font-semibold">Resume</h2>
        <pre className="overflow-x-auto whitespace-pre-wrap font-body text-[13px] text-ink-soft">
          {JSON.stringify(detail.resume, null, 2)}
        </pre>
      </BorderedCard>

      <BorderedCard className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-[18px] font-semibold">Your decision</h2>
        <DecideForm verificationId={detail.id} candidateId={detail.candidateId} />
      </BorderedCard>

      <form action={release}>
        <Button type="submit" variant="ghost" size="sm">
          Release without deciding
        </Button>
      </form>
    </Container>
  );
}
