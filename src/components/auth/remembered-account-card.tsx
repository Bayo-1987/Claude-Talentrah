"use client";

/**
 * The sign-in page's "Continue as <email>" card (LOGIN-REMEMBERED-ACCOUNT-1).
 *
 * Presentation only. Tapping the card reveals the normal sign-in form with this email already in it; the link underneath forgets the
 * address and shows the empty form. Neither changes how anyone is authenticated, and the password is never stored or shown here.
 *
 * The address is rendered as a React text node, which escapes it, and it has already passed `isPlainEmail` before it gets this far. It is
 * given `break-all` rather than truncated so a long address is still readable in full on a 360px screen.
 */
export function RememberedAccountCard({
  email,
  onContinue,
  onUseAnother,
}: {
  email: string;
  onContinue: () => void;
  onUseAnother: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="remembered-account">
      <button
        type="button"
        onClick={onContinue}
        className="flex min-h-14 w-full flex-col items-start gap-0.5 border-[1.5px] border-ink bg-card px-3.5 py-3 text-left hover:border-rust focus-visible:border-rust"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-rust">Continue as</span>
        <span className="break-all font-body text-[15px] font-semibold text-ink">{email}</span>
      </button>
      <button
        type="button"
        onClick={onUseAnother}
        className="inline-flex min-h-10 items-center gap-1.5 self-start text-[12.5px] text-ink-soft underline-offset-2 hover:text-rust"
      >
        <span className="text-[11px]">Not you?</span>
        <span className="underline">Use another account</span>
      </button>
    </div>
  );
}
