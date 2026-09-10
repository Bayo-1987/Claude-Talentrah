import { requireUser } from "@/lib/auth/require-user";
import {
  getOwnVerificationState,
  getVerificationHistory,
  getOwnPortfolioItems,
} from "@/lib/talent-directory/queries";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { VerificationPanel } from "./verification-panel";
import { HumanReviewForm } from "./human-review-form";
import { OptInToggle } from "./opt-in-toggle";
import { AvailabilityForm } from "./availability-form";
import { PortfolioManager } from "./portfolio-manager";

export const metadata = { title: "Get Verified — Talentrah" };

const STATUS_COPY: Record<string, string> = {
  unverified: "You haven't requested verification yet.",
  pending: "Your verification is being graded, or waiting for a reviewer to pick it up.",
  claimed: "A mentor is reviewing your submission now.",
  verified: "You're verified.",
  rejected: "Your last attempt wasn't verified — see the feedback below.",
};

/**
 * Talent Directory & Verification, seeker-facing half (send-139, build-prompt
 * §6.13 v1 slice). One page for the whole lifecycle: request verification,
 * see history, opt in to the directory, and manage the metadata employers
 * would see — same reasoning as Mentorship's own /mentorship/apply page for
 * why this isn't split further.
 *
 * VERIFIED DOES NOT LIST YOU. Opting in is a second, independent step (see
 * OptInToggle below) — 0135's own header spells out why: "public visibility
 * is a bigger exposure change than anything automatic," the same reasoning
 * the referral leaderboard already used for a structurally identical choice.
 */
export default async function TalentDirectoryVerifyPage() {
  const { user } = await requireUser();
  const [state, history, portfolioItems] = await Promise.all([
    getOwnVerificationState(user.id),
    getVerificationHistory(user.id),
    getOwnPortfolioItems(user.id),
  ]);

  if (!state) return null;

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Get verified</h1>
      <p className="max-w-[560px] text-[14.5px] text-ink-soft">
        A verified badge tells local employers your resume holds up —
        complete, specific, and internally consistent. Farah grades it
        automatically; verifying costs {CREDIT_COSTS.talentDirectoryVerification}{" "}
        credits. Prefer a person to look it over instead? A Talentrah mentor
        can review it directly for {CREDIT_COSTS.talentDirectoryHumanReview} credits.
      </p>

      <BorderedCard className="flex flex-col gap-3 p-5">
        <p className="text-[14px] text-ink">{STATUS_COPY[state.status] ?? state.status}</p>
        {state.score != null && (
          <p className="text-[13px] text-ink-soft">Last score: {state.score}/100</p>
        )}
        <VerificationPanel status={state.status} />
        {(state.status === "unverified" || state.status === "rejected") && <HumanReviewForm />}
      </BorderedCard>

      {state.status === "verified" && (
        <BorderedCard className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-[18px] font-semibold">List yourself in the directory</h2>
          <OptInToggle optIn={state.optIn} />
        </BorderedCard>
      )}

      <BorderedCard className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-[18px] font-semibold">Availability</h2>
        <AvailabilityForm
          availableForHire={state.availableForHire}
          remoteReady={state.remoteReady}
          earliestStartDate={state.earliestStartDate}
        />
      </BorderedCard>

      <BorderedCard className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-[18px] font-semibold">Work samples</h2>
        <PortfolioManager items={portfolioItems} />
      </BorderedCard>

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[18px] font-semibold">Verification history</h2>
          {history.map((h) => (
            <BorderedCard key={h.id} className="flex flex-col gap-1.5 p-4">
              <p className="text-[13.5px] text-ink">
                {new Date(h.requestedAt).toLocaleDateString()} · {h.status}
                {h.score != null && ` · ${h.score}/100`}
              </p>
              {h.feedback && <p className="text-[13px] text-ink-soft">{h.feedback}</p>}
            </BorderedCard>
          ))}
        </section>
      )}
    </Container>
  );
}
