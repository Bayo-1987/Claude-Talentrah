import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Payment — Talentrah" };

export default async function BillingCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  // The session user is passed through, not just required. `reference`
  // arrives as a URL query parameter, and fulfillPayment runs on the
  // service-role client (which bypasses RLS), so without scoping this to
  // the signed-in user any reference would be actionable by anyone.
  const { user } = await requireUser();
  const { reference } = await searchParams;

  let outcome: "success" | "already_processed" | "failed" | "not_found" | "error" = "error";
  if (reference) {
    try {
      const result = await fulfillPayment(reference, user.id);
      outcome = result.status;
    } catch {
      outcome = "error";
    }
  }

  const isOk = outcome === "success" || outcome === "already_processed";

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
      <EyebrowLabel>{isOk ? "Payment received" : "Payment issue"}</EyebrowLabel>
      <h1 className="font-display text-[26px]">
        {isOk ? "You're all set." : "Something didn't go through."}
      </h1>
      <p className="text-[14.5px] text-ink-soft">
        {isOk
          ? "Your credits or pass have been added to your account."
          : "We couldn't confirm this payment. If you were charged, contact support and we'll sort it out."}
      </p>
      <Link
        href="/billing"
        className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        Back to Credits & Passes
      </Link>
    </div>
  );
}
