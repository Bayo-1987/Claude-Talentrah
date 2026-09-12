import { requireUser } from "@/lib/auth/require-user";
import { getReviewQueue, getMyClaimedReviews } from "@/lib/talent-directory/review-queries";
import { claimVerificationReviewAction } from "@/lib/talent-directory/reviewer-actions";
import { Container, EyebrowLabel, Card, Button } from "@/components/ui";

export const metadata = { title: "Verification reviews — Talentrah" };

/**
 * The reviewer-picks-from-a-pool surface (0141/0142, design decision 2).
 * getReviewQueue/getMyClaimedReviews are both SECURITY DEFINER functions
 * that return an empty result for anyone who isn't an approved mentor with
 * reviews_verifications=true — this page renders that as "nothing in the
 * queue" rather than checking eligibility itself, matching how
 * talent_directory pages already lean on their own RPCs' entitlement checks
 * instead of duplicating them client-side.
 */
export default async function VerificationReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;
  const [queue, myClaims] = await Promise.all([getReviewQueue(), getMyClaimedReviews()]);

  async function claim(formData: FormData) {
    "use server";
    await claimVerificationReviewAction(String(formData.get("verificationId")));
  }

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Verification reviews</h1>
      <p className="max-w-[560px] text-[14.5px] text-ink-soft">
        Candidates who paid for a human-reviewed verification land here, unclaimed. Claim one to
        review it — best expertise matches are shown first.
      </p>

      {error && <p className="text-[13px] text-coral">{decodeURIComponent(error)}</p>}

      {myClaims.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[18px] font-semibold">Your claimed reviews</h2>
          {myClaims.map((c) => (
            <Card key={c.id} className="flex flex-col gap-2 p-5">
              <p className="text-[14px] text-ink">
                {c.targetRole ?? "No target role stated"}
                {c.targetIndustry ? ` · ${c.targetIndustry}` : ""}
              </p>
              <p className="text-[13px] text-ink-soft">Claimed {new Date(c.claimedAt).toLocaleString()}</p>
              <a href={`/mentorship/reviews/${c.id}`} className="text-[13.5px] text-coral">
                Continue reviewing ↗
              </a>
            </Card>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[18px] font-semibold">Unclaimed pool</h2>
        {queue.length === 0 ? (
          <p className="text-[14px] text-ink-soft">
            Nothing waiting right now — or you&apos;re not opted in to reviewing yet
            (Mentorship → Your mentor profile → Talent Directory reviews).
          </p>
        ) : (
          queue.map((item) => (
            <Card key={item.id} className="flex flex-col gap-2 p-5">
              <p className="text-[14px] text-ink">
                {item.targetRole ?? "No target role stated"}
                {item.targetIndustry ? ` · ${item.targetIndustry}` : ""}
                {item.expertiseMatch && <span className="ml-2 text-[12px] text-green">Matches your expertise</span>}
              </p>
              <p className="text-[13px] text-ink-soft">Requested {new Date(item.requestedAt).toLocaleString()}</p>
              <form action={claim}>
                <input type="hidden" name="verificationId" value={item.id} />
                <Button type="submit" variant="primary" size="sm">
                  Claim
                </Button>
              </form>
            </Card>
          ))
        )}
      </section>
    </Container>
  );
}
