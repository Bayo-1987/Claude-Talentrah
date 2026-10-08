import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { EyebrowLabel } from "@/components/ui";
import { PaymentProcessingNotice } from "@/components/billing/payment-processing";
import { callbackOutcome, type CallbackOutcome } from "@/lib/billing/callback-outcome";

export const metadata = { title: "Payment — Talentrah" };

/**
 * Mentor-session equivalent of (app)/billing/callback — kept as its own page
 * rather than folded into that one because a mentor-session payment redirects
 * to /mentorship/sessions on success, not /billing. Same reasoning as that
 * page's own header for why success redirects rather than rendering inline:
 * the layout's credits badge and this page are sibling renders of one
 * request, and a redirect is what guarantees the next render happens after
 * fulfilment actually committed.
 */
export default async function MentorBookingCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { user } = await requireUser();
  const { reference } = await searchParams;

  let outcome: CallbackOutcome = "error";
  if (reference) {
    try {
      const result = await fulfillPayment(reference, user.id);
      // A session-scoped call can never reach a deleted user's row (it is scoped to this signed-in user), so needs_refund is not reachable here; callbackOutcome treats it as an error defensively.
      outcome = callbackOutcome(result.status);
    } catch {
      outcome = "error";
    }
  }

  if (outcome === "paid") {
    redirect("/mentorship/sessions?booked=1");
  }

  if (outcome === "processing") {
    return <PaymentProcessingNotice backHref="/mentorship" backLabel="Start again from Mentorship" />;
  }

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
      <EyebrowLabel>Payment issue</EyebrowLabel>
      <h1 className="font-display text-[26px]">Something didn&apos;t go through.</h1>
      <p className="text-[14.5px] text-ink-soft">
        We couldn&apos;t confirm this payment. If you were charged, contact
        support and we&apos;ll sort it out.
      </p>
      <Link
        href="/mentorship"
        className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        Back to Mentorship
      </Link>
    </div>
  );
}
