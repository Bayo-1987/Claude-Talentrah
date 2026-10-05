import { SignupCodeForm, SignupCodeEnded } from "@/components/auth/signup-code-form";
import { getCheckEmailView } from "@/lib/auth/check-email-view";

export const metadata = { title: "Check your email — Talentrah" };

/**
 * The code page (S1-101). It takes NO query string: the address comes from the pending-signup cookie the signup action sets, and is shown masked. A visit
 * with no cookie (it ended, or nothing was started) is a calm "start again" state, not an error.
 */
export default async function CheckEmailPage() {
  const view = await getCheckEmailView();
  if (!view) return <SignupCodeEnded />;
  return <SignupCodeForm maskedEmail={view.maskedEmail} initialCooldownSeconds={view.cooldownSeconds} webmailUrl={view.webmailUrl} />;
}
