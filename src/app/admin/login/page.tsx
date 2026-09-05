import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/require-admin";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { AdminLoginForm } from "@/components/admin/admin-login-form";

/**
 * The admin door. Outside the (protected) group, so the guard does not wrap
 * it.
 *
 * NOT the seeker login page and not a mode of it. Three things are absent:
 * OAuth buttons, a "create a free account" link, and any password reset.
 * There is no self-serve route INTO this surface — an admin exists because
 * someone ran scripts/grant-admin.ts against the service role.
 *
 * THE PASSWORD-RESET LINK IS ABSENT FOR A DIFFERENT REASON THAN IT USED TO BE,
 * and the distinction decides when it can be added.
 *
 * The old reason was "a page that offers a way in is a page someone will find
 * a way through". That is wrong here, and was: the seeker forgot-password flow
 * calls `resetPasswordForEmail`, which operates on any `auth.users` row
 * including every operator, with deliberately no admin exclusion — so the
 * capability is already reachable at /forgot-password by anyone who types the
 * URL. Withholding a link never changed the attack surface, only who could
 * find it, and the person who could not find it was the locked-out operator.
 *
 * The real reason is that recovery does not currently work reliably enough to
 * advertise. The project's password-reset email quota is TWO PER HOUR and is
 * PROJECT-WIDE, not per address — measured, not read from config: a second
 * known address is refused immediately after the first exhausts it. So any two
 * requests deny password recovery to every user and both operators for the
 * rest of the window, and nothing in front of it rate-limits by IP or address
 * (`consumeRateLimit` has three callers and none is in the auth flow).
 *
 * Pointing the admin door at that flow would advertise a remedy that anyone
 * can switch off for an hour. The link goes in once custom SMTP is configured
 * on the project and the quota is no longer trivially exhaustible; that is a
 * dashboard change, not a code change. See docs/admin-auth.md.
 */
export const metadata = {
  title: "Admin sign-in — Talentrah",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo: raw } = await searchParams;
  // Validated once here, and the validated value is what the form carries, so
  // a hostile ?redirectTo never reaches the hidden field. The extra /admin
  // constraint is this page's own — see adminLoginAction.
  const candidate = safeRedirectTo(raw, "");
  const redirectTo =
    candidate.startsWith("/admin") && !candidate.startsWith("/admin/login") ? candidate : "";

  // Already signed in and following a link to something specific: honour it
  // rather than dropping them on the dashboard, same as the seeker login.
  const admin = await getAdmin();
  if (admin) redirect(redirectTo || "/admin");

  return (
    <Container className="flex max-w-[520px] flex-col gap-8 py-20">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Talentrah admin</EyebrowLabel>
        <h1 className="font-display text-[28px]">Sign in to the admin area.</h1>
        <p className="text-[14.5px] text-ink-soft">
          Operator accounts only. A Talentrah account on its own does not open
          this door.
        </p>
      </div>

      <BorderedCard className="p-6">
        <AdminLoginForm redirectTo={redirectTo || undefined} />
      </BorderedCard>
    </Container>
  );
}
