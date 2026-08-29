import Link from "next/link";
import { redirect } from "next/navigation";
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

  let outcome:
    "success" | "already_processed" | "failed" | "not_found" | "error" =
    "error";
  if (reference) {
    try {
      const result = await fulfillPayment(reference, user.id);
      outcome = result.status;
    } catch {
      outcome = "error";
    }
  }

  /*
   * ── SUCCESS LEAVES THIS PAGE, AND THAT IS THE BUG FIX ─────────────────────
   *
   * This page used to render its own confirmation inline. The credits badge
   * beside it comes from (app)/layout.tsx, which calls requireUser()
   * independently — a SIBLING render, not something sequenced after the
   * mutation above. React renders the layout and the page for one request
   * without ordering them around a grant that happened inside the page, so the
   * badge could show the PRE-GRANT balance in the very response whose headline
   * says "You're all set." The grant itself was always correct; what was wrong
   * was a number rendered next to it claiming otherwise.
   *
   * A redirect is what fixes it rather than any amount of care inside this
   * component: it ends this request and starts a new one, and the layout's read
   * on that request happens strictly after the grant committed. There is no
   * ordering to get right because there is no longer a shared render.
   *
   * It also gets the URL bar off the raw Paystack reference, which is a
   * meaningless string to the person looking at it and the thing they would
   * bookmark or share.
   *
   * `purchased=1`, deliberately not the reference. /billing reads the most
   * recent successful transaction it has already queried, so passing the
   * reference would put a receipt number back in the URL to solve a problem
   * that does not need it — the exact thing this redirect is removing.
   *
   * redirect() throws NEXT_REDIRECT, so it must sit OUTSIDE the try/catch
   * above; inside it, the catch would swallow the redirect and report `error`.
   *
   * FAILURE STAYS HERE. It has something specific to say and nowhere better to
   * say it, and bouncing someone whose payment did not go through onto a page
   * of things to buy would be the wrong reading of the moment.
   */
  if (outcome === "success" || outcome === "already_processed") {
    redirect("/billing?purchased=1");
  }

  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center">
      <EyebrowLabel>Payment issue</EyebrowLabel>
      <h1 className="font-display text-[26px]">
        Something didn&apos;t go through.
      </h1>
      <p className="text-[14.5px] text-ink-soft">
        We couldn&apos;t confirm this payment. If you were charged, contact
        support and we&apos;ll sort it out.
      </p>
      <Link
        href="/billing"
        className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        Back to Credits &amp; Passes
      </Link>
    </div>
  );
}
