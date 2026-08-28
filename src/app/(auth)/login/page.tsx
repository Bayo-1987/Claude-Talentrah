import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { EyebrowLabel } from "@/components/ui";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export const metadata = { title: "Log in — Talentrah" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirectTo?: string }>;
}) {
  const { error, redirectTo: rawRedirectTo } = await searchParams;
  // Validated once, here, and the validated value is what the form carries —
  // so a hostile ?redirectTo never reaches the hidden field either.
  const redirectTo = safeRedirectTo(rawRedirectTo, "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  /*
   * An already-signed-in visitor followed a link to something specific. Sending
   * them to /dashboard unconditionally — as this did — discards it, which is
   * the same lost-destination bug as the bare /login redirect, just on the
   * other side of the door.
   */
  if (user) redirect(redirectTo || "/dashboard");

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Welcome back</EyebrowLabel>
        <h2 className="font-display text-[28px]">Log in to Talentrah.</h2>
        <p className="text-[14.5px] text-ink-soft">
          New here?{" "}
          <a
            href={redirectTo ? `/signup?redirectTo=${encodeURIComponent(redirectTo)}` : "/signup"}
            className="underline"
          >
            Create a free account
          </a>
          .
        </p>
      </div>

      {error === "oauth_unavailable" && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          That sign-in method isn&apos;t available yet — try email and password
          instead.
        </p>
      )}
      {error === "auth_callback_failed" && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust">
          That link has expired or was already used. Please try again.
        </p>
      )}

      <OAuthButtons />

      <div className="flex items-center gap-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <LoginForm redirectTo={redirectTo || undefined} />
    </div>
  );
}
