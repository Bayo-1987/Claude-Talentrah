import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export const metadata = { title: "Log in — Talentrah" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Welcome back</EyebrowLabel>
        <h2 className="font-display text-[28px]">Log in to Talentrah.</h2>
        <p className="text-[14.5px] text-ink-soft">
          New here?{" "}
          <a href="/signup" className="underline">
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

      <LoginForm />
    </div>
  );
}
