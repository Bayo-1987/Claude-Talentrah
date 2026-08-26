import Link from "next/link";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { requireEmployer } from "@/lib/employer/membership";
import { BorderedCard, EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Top-up — Talentrah" };

/**
 * Where Paystack returns the employer after a wallet top-up.
 *
 * This is the SECOND path that fulfils the same reference — the webhook at
 * /api/webhooks/paystack is the first, and which arrives first is a race.
 * That is deliberate and standard: the webhook is authoritative but can be
 * delayed, and a user staring at a spinner because a background call has not
 * landed is a worse product than fulfilling twice and having the second be a
 * no-op.
 *
 * "A no-op" is doing real work here, not hand-waving:
 * `credit_ad_wallet` dedupes on a UNIQUE partial index over
 * `paystack_reference`, so whichever path arrives second credits nothing. See
 * the note in fulfill.ts for why that index — rather than the read-then-act
 * `status !== "pending"` guard — is what actually prevents a double credit.
 *
 * The session user is passed to fulfillPayment, not merely required: the
 * reference arrives as a URL query parameter, so without binding it to the
 * signed-in user any reference would be actionable by anyone holding it.
 */
export default async function TopUpCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  const { userId } = await requireEmployer();

  let heading = "We couldn't find that payment";
  let body = "If you were charged, it will appear in your wallet once Paystack confirms it.";

  if (reference) {
    const result = await fulfillPayment(reference, userId);
    if (result.status === "success" || result.status === "already_processed") {
      heading = "Top-up complete";
      body = "Your ad wallet has been credited. Campaigns will charge against it from their next run.";
    } else if (result.status === "failed") {
      heading = "That payment didn't go through";
      body = "Nothing was added to your wallet, and you have not been charged.";
    }
  }

  return (
    <div className="max-w-[620px]">
      <EyebrowLabel>Ad wallet</EyebrowLabel>
      <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
        {heading}
      </h1>
      <BorderedCard className="mt-5 p-6">
        <p className="font-body text-[15px] leading-[1.65] text-ink">{body}</p>
        <div className="mt-5">
          <Link
            href="/employer/campaigns"
            className="font-body text-[14px] font-semibold text-rust no-underline hover:text-rust-hover"
          >
            Back to Ad Campaigns →
          </Link>
        </div>
      </BorderedCard>
    </div>
  );
}
