import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin/require-admin";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { AdminLoginForm } from "@/components/admin/admin-login-form";

/**
 * The admin door. Outside the (protected) group, so the guard does not wrap
 * it.
 *
 * NOT the seeker login page and not a mode of it. Three things are absent on
 * purpose: OAuth buttons, a "create a free account" link, and any password
 * reset. There is no self-serve route into this surface — an admin exists
 * because someone ran scripts/grant-admin.ts against the service role — and a
 * page that offers a way in is a page someone will find a way through.
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
