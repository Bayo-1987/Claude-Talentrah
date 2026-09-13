import { EyebrowLabel } from "@/components/ui";
import { CheckEmailIcon } from "@/components/auth/check-email-icon";
import { CheckEmailActions } from "@/components/auth/check-email-actions";

export const metadata = { title: "Check your email — Talentrah" };

/**
 * The confirmation, and the second half of the anti-enumeration rule.
 *
 * Mirrors /signup/check-email's redesign, including its careful conditional
 * phrasing: "IF an account exists" is doing real work, because this page is
 * reached identically whether or not one does. A sentence that read "we've
 * sent you a link" would be a claim this page cannot make, and — worse — the
 * difference between it and some other wording for unknown addresses is
 * precisely the signal the whole flow refuses to give. The resend action
 * below inherits that same guarantee by calling `resetPasswordForEmail` the
 * same way `requestPasswordResetAction` already does — see
 * resendPasswordResetAction's own comment in actions.ts.
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
      <CheckEmailIcon />
      <EyebrowLabel>Check your email</EyebrowLabel>
      <h2 className="font-display text-[28px]">On its way.</h2>
      <p className="text-[15px] text-ink-soft">
        If an account exists for {email ? "the address below" : "that email"},
        we&apos;ve sent a link to reset your password. It expires after a
        short while, so use it soon.
      </p>

      {email && (
        <div className="flex items-center justify-between gap-3 border-[1.5px] border-line bg-bg px-3.5 py-3">
          <span className="break-all text-[14.5px] font-semibold text-ink">{email}</span>
          <a href="/forgot-password" className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-coral">
            Wrong address?
          </a>
        </div>
      )}

      {email && <CheckEmailActions email={email} kind="password-reset" />}

      <p className="text-[12.5px] text-ink-soft">
        Didn&apos;t get it? Check your spam or promotions folder — it can take
        a minute to arrive.
      </p>

      <div className="border-t border-line" />
      <p className="text-[13.5px] text-ink-soft">
        Remembered it?{" "}
        <a href="/login" className="font-semibold text-coral underline underline-offset-3">
          Log in
        </a>
      </p>
    </div>
  );
}
