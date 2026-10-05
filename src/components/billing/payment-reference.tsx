/** The full Paystack reference, kept for support behind a disclosure so the page shows the short receipt number first. */
export function PaymentReference({ reference }: { reference: string }) {
  return (
    <details className="font-body text-[11.5px] text-ink-soft">
      <summary className="inline-flex min-h-11 cursor-pointer items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust">
        Payment reference
      </summary>
      <code className="break-all text-[11px]">{reference}</code>
    </details>
  );
}
