import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Check your email — Talentrah" };

/**
 * The confirmation, and the second half of the anti-enumeration rule.
 *
 * Mirrors /signup/check-email, including its careful conditional phrasing:
 * "IF an account exists" is doing real work, because this page is reached
 * identically whether or not one does. A sentence that read "we've sent you a
 * link" would be a claim this page cannot make, and — worse — the difference
 * between it and some other wording for unknown addresses is precisely the
 * signal the whole flow refuses to give.
 *
 * The address is echoed only to catch a typo, and it is the one the visitor
 * just typed, so showing it reveals nothing they did not already supply.
 */
export default async function ForgotPasswordCheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div data-testid="reset-confirmation" className="flex flex-col gap-4">
      <EyebrowLabel>Check your email</EyebrowLabel>
      <h2 className="font-display text-[28px]">On its way.</h2>
      <p className="text-[15px] text-ink-soft">
        If an account exists for{" "}
        {email ? <strong className="text-ink">{email}</strong> : "that email"},
        we&apos;ve sent a link to reset your password. It expires after a short
        while, so use it soon.
      </p>
      <p className="text-[13.5px] text-ink-soft">
        Didn&apos;t get it? Check your spam folder, or{" "}
        <a href="/forgot-password" className="underline">
          try a different email
        </a>
        . You can also{" "}
        <a href="/login" className="underline">
          go back to log in
        </a>
        .
      </p>
    </div>
  );
}
