import { EyebrowLabel } from "@/components/ui";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Reset your password — Talentrah" };

/**
 * No signed-in redirect, unlike /login and /signup.
 *
 * Those bounce an authenticated visitor because arriving at them signed in
 * means the visitor is lost. Arriving here signed in is a normal thing to
 * want: someone who is logged in on a laptop and has forgotten the password
 * they need on their phone is exactly the person this page is for.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Forgot your password?</EyebrowLabel>
        <h2 className="font-display text-[28px]">We&apos;ll send you a link.</h2>
        <p className="text-[14.5px] text-ink-soft">
          Enter the email you signed up with and we&apos;ll send a link to set a
          new password. Remembered it?{" "}
          <a href="/login" className="underline">
            Log in
          </a>
          .
        </p>
      </div>

      {/*
        Sent here by /reset-password when the session had gone. Explained
        rather than dropped: arriving back at a form you already filled in,
        with no word about why, reads as the app losing your submission.
        Matches the way /login surfaces its own callback failures.
      */}
      {error === "link_expired" && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          That reset link has expired or was already used. Enter your email to
          get a new one.
        </p>
      )}

      <ForgotPasswordForm />
    </div>
  );
}
