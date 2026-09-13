import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Payment — Talentrah" };

/**
 * Talent Directory subscription's own callback — same reasoning as
 * Mentorship's own /mentorship/book/callback and (app)/billing/callback:
 * success redirects (so the subscription-status read on the next render
 * happens strictly after fulfilment committed) rather than rendering inline.
 *
 * SCOPED TO THE ORG, not just the signed-in user — `fulfillPayment`'s
 * `expectedUserId` only checks `transaction.user_id`, which here is the
 * purchasing member, not the org. Two members of the same org could both
 * reach this page for a transaction the OTHER one started; that is fine —
 * either way it is the same organisation's subscription being fulfilled —
 * so this intentionally does not add an org-ownership check beyond what
 * fulfillPayment already does.
 */
export default async function TalentDirectoryCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const context = await requireEmployer();
  const { reference } = await searchParams;

  let outcome: "success" | "already_processed" | "failed" | "not_found" | "error" = "error";
  if (reference) {
    try {
      const result = await fulfillPayment(reference, context.userId);
      outcome = result.status;
    } catch {
      outcome = "error";
    }
  }

  if (outcome === "success" || outcome === "already_processed") {
    redirect("/employer/talent-directory?purchased=1");
  }

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
      <EyebrowLabel>Payment issue</EyebrowLabel>
      <h1 className="font-display text-[26px]">Something didn&apos;t go through.</h1>
      <p className="text-[14.5px] text-ink-soft">
        We couldn&apos;t confirm this payment. If you were charged, contact support and we&apos;ll sort it out.
      </p>
      <Link
        href="/employer/talent-directory"
        className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-bg no-underline transition-colors hover:bg-coral"
      >
        Back to Talent Directory
      </Link>
    </div>
  );
}
