import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { SignupForm } from "@/components/auth/signup-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

export const metadata = { title: "Create your account — Talentrah" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const { ref } = await searchParams;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Create a free account</EyebrowLabel>
        <h2 className="font-display text-[28px]">Let&apos;s get you set up.</h2>
        <p className="text-[14.5px] text-ink-soft">
          Already have an account?{" "}
          <a href="/login" className="underline">
            Log in
          </a>
          .
        </p>
      </div>

      <OAuthButtons />

      <div className="flex items-center gap-3 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <SignupForm referredByCode={ref} />
    </div>
  );
}
