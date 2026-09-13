import { EyebrowLabel } from "@/components/ui";
import { CheckEmailIcon } from "@/components/auth/check-email-icon";
import { CheckEmailActions } from "@/components/auth/check-email-actions";

export const metadata = { title: "Check your email — Talentrah" };

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <CheckEmailIcon />
      <EyebrowLabel>One more step</EyebrowLabel>
      <h2 className="font-display text-[28px]">Check your email.</h2>
      <p className="text-[15px] text-ink-soft">
        We&apos;ve sent a confirmation link to{" "}
        {email ? "the address below" : "your inbox"} — click it to activate
        your account. If you already have one here, no new email goes out;
        just log in instead.
      </p>

      {email && (
        <div className="flex items-center justify-between gap-3 border-[1.5px] border-line bg-bg px-3.5 py-3">
          <span className="break-all text-[14.5px] font-semibold text-ink">{email}</span>
          <a href="/signup" className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-soft underline underline-offset-2 hover:text-coral">
            Wrong address?
          </a>
        </div>
      )}

      {email && <CheckEmailActions email={email} kind="signup" />}

      <p className="text-[12.5px] text-ink-soft">
        Didn&apos;t get it? Check your spam or promotions folder — it can take
        a minute to arrive.
      </p>

      <div className="border-t border-line" />
      <p className="text-[13.5px] text-ink-soft">
        Already confirmed?{" "}
        <a href="/login" className="font-semibold text-coral underline underline-offset-3">
          Log in
        </a>
      </p>
    </div>
  );
}
