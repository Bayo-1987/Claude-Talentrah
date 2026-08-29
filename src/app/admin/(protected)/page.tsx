import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * M1's landing page. Deliberately thin: it exists so /admin is a real
 * destination for the guard to send someone to, and so the milestone's claim —
 * "there is a session identity an action could be attributed to" — is
 * something an operator can see rather than something a test asserts.
 *
 * M2 replaces this body with the dashboard shell and the three moderation
 * queues. The nav is not stubbed out here for the same reason Billing and
 * Analytics are absent from the employer nav: a link to a page that does not
 * exist reads as a shipped feature.
 */
export default async function AdminHomePage() {
  const admin = await requireAdmin();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Admin</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">
          Signed in as {admin.displayName || admin.email}.
        </h1>
        <p className="max-w-[620px] text-[15px] text-ink-soft">
          This session is recorded, expires on its own, and can be revoked from
          the database. Anything you do from here can be attributed to it — which
          is the whole of what this milestone builds.
        </p>
      </div>

      <BorderedCard className="flex max-w-[640px] flex-col gap-3 p-5">
        <EyebrowLabel>Session</EyebrowLabel>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[14.5px]">
          <dt className="text-ink-soft">Account</dt>
          <dd>{admin.email}</dd>
          <dt className="text-ink-soft">Admin id</dt>
          <dd className="font-mono text-[13px]">{admin.adminId}</dd>
          <dt className="text-ink-soft">Session id</dt>
          <dd className="font-mono text-[13px]">{admin.sessionId}</dd>
          <dt className="text-ink-soft">Expires</dt>
          <dd>{new Date(admin.expiresAt).toLocaleString()}</dd>
        </dl>
      </BorderedCard>

      <div className="flex flex-col gap-3">
        <EyebrowLabel>What exists today</EyebrowLabel>
        <p className="max-w-[620px] text-[15px] text-ink-soft">
          Three moderation queues, each backed by logic that has been live and
          tested for a while and had no screen until now. Everything else in the
          domain map — feedback triage, user support, financial visibility — is a
          real gap rather than a shipped feature, so it is absent from the nav
          instead of stubbed.
        </p>
        <ul className="flex list-none flex-col gap-2 p-0 text-[15px]">
          <li>
            <Link href="/admin/scholarships" className="underline">
              Scholarship review
            </Link>{" "}
            — approve into the public catalog, or reject with a reason.
          </li>
          <li>
            <Link href="/admin/reports" className="underline">
              Reported postings
            </Link>{" "}
            — ranked by distinct reporters; remove or restore.
          </li>
          <li>
            <Link href="/admin/campaigns" className="underline">
              Ad campaign review
            </Link>{" "}
            — approving never starts a campaign or spends anything.
          </li>
        </ul>
      </div>

    </Container>
  );
}
