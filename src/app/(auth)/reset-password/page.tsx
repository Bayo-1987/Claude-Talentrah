import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Set a new password — Talentrah" };

/**
 * Reached from the emailed link, via /auth/callback, holding a recovery
 * session. That session is the entire authorisation for the form below, which
 * is why this page checks for one before rendering anything.
 *
 * SENT BACK TO /forgot-password, NOT SHOWN A BROKEN FORM. Without a session
 * there are two ways to be here — the link expired, or the URL was opened
 * directly — and both have the same remedy: get a new link. Rendering the form
 * anyway would let someone type a new password, submit it, and be told only
 * then that it went nowhere.
 *
 * Not /login either. Someone who cannot log in is the reason this page exists,
 * so the useful destination is the start of this flow rather than the door
 * they already could not get through.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/forgot-password?error=link_expired");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Almost done</EyebrowLabel>
        <h2 className="font-display text-[28px]">Set a new password.</h2>
        <p className="text-[14.5px] text-ink-soft">
          You&apos;re signed in as{" "}
          <strong className="text-ink">{user.email}</strong>. Choose a new
          password and we&apos;ll take you straight to your jobs.
        </p>
      </div>

      <ResetPasswordForm />
    </div>
  );
}
