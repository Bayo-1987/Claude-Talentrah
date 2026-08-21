import { requireUser } from "@/lib/auth/require-user";
import { signOutAction } from "@/lib/auth/actions";
import { EyebrowLabel, Button, Container } from "@/components/ui";

export const metadata = { title: "Dashboard — Talentrah" };

/**
 * Placeholder landing spot post-auth. Gets replaced by the real Job Feed in
 * M3 — exists now so the auth flow (M1) has a real, verifiable destination.
 */
export default async function DashboardPage() {
  const { user, profile } = await requireUser();

  return (
    <div className="min-h-screen">
      <div className="border-b-[2.5px] border-ink">
        <Container className="flex h-[68px] items-center justify-between">
          <span className="font-display text-[24px] font-medium tracking-tight">
            Talentrah
          </span>
          <div className="flex items-center gap-3.5">
            <span className="inline-flex min-h-10 items-center bg-rust-soft px-3.5 text-[13px] font-bold text-rust">
              {profile.credits_balance} credits
            </span>
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ink font-display text-[12px] font-bold text-paper">
              {profile.first_name?.[0]}
              {profile.last_name?.[0]}
            </div>
          </div>
        </Container>
      </div>

      <Container className="flex flex-col gap-6 py-14">
        <EyebrowLabel>Welcome back</EyebrowLabel>
        <h1 className="font-display text-[30px]">
          Good to see you, {profile.first_name}.
        </h1>
        <p className="max-w-[520px] text-[15px] text-ink-soft">
          The job feed, tracker, and resume builder land in the next
          milestones. For now, here&apos;s what&apos;s live on your account.
        </p>

        <div className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-5 max-w-[420px]">
          <div className="flex justify-between text-[14px]">
            <span className="text-ink-soft">Email</span>
            <span>{user.email}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-ink-soft">Email verified</span>
            <span>{user.email_confirmed_at ? "Yes" : "Not yet"}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-ink-soft">Country</span>
            <span>{profile.country}</span>
          </div>
          <div className="flex justify-between text-[14px]">
            <span className="text-ink-soft">Referral code</span>
            <span>{profile.referral_code}</span>
          </div>
        </div>

        <form action={signOutAction}>
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </Container>
    </div>
  );
}
