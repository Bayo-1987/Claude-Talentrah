import Link from "next/link";
import { EyebrowLabel } from "@/components/ui";

/**
 * What a buyer sees when Paystack sends them back before the payment has finished (fulfillPayment answered "processing": a bank transfer, USSD or mobile-money payment that has not
 * settled, or a checkout that is still open). It is NOT a failure: the payment may still complete, and when it does we confirm it automatically. So it says that nothing has been added
 * yet, that they must not pay again, and where to go; it promises no time, because the length of a transfer is the bank's.
 */
export const PAYMENT_PROCESSING_HEADING = "Your payment is still processing.";
export const PAYMENT_PROCESSING_BODY =
  "Your bank or Paystack hasn't confirmed it yet, so nothing has been added yet. If you paid, it will appear here shortly: please do not pay again. If you did not complete the payment, you can start again. If it still hasn't appeared after your bank has confirmed the payment, contact support and we'll sort it out.";

/** `backHref` is the page where the purchase is made, so the "start again" link lands where the buyer can begin the same purchase over. */
export function PaymentProcessingNotice({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  return (
    <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-16 text-center" role="status">
      <EyebrowLabel>Payment processing</EyebrowLabel>
      <h1 className="font-display text-[26px]">{PAYMENT_PROCESSING_HEADING}</h1>
      <p className="text-[14.5px] text-ink-soft">{PAYMENT_PROCESSING_BODY}</p>
      <Link
        href={backHref}
        className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
      >
        {backLabel}
      </Link>
    </div>
  );
}
