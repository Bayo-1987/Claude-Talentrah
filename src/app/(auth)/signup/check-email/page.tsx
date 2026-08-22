import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Check your email — Talentrah" };

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <EyebrowLabel>One more step</EyebrowLabel>
      <h2 className="font-display text-[28px]">Check your email.</h2>
      <p className="text-[15px] text-ink-soft">
        If this is a new signup, we&apos;ve sent a confirmation link to{" "}
        {email ? <strong className="text-ink">{email}</strong> : "your inbox"}.
        Click it to activate your account, then come back and{" "}
        <a href="/login" className="underline">
          log in
        </a>
        .
      </p>
      <p className="text-[13.5px] text-ink-soft">
        If you already have an account with this email,{" "}
        <a href="/login" className="underline">
          log in instead
        </a>{" "}
        — no new email is sent for an address that&apos;s already registered.
      </p>
    </div>
  );
}
