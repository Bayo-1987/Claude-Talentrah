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
const DASHBOARD_LINKS = [
  {
    href: "/admin/scholarships",
    label: "Scholarship review",
    permission: "scholarships",
    blurb: "approve into the public catalog, or reject with a reason.",
  },
  {
    href: "/admin/reports",
    label: "Reported postings",
    permission: "reported_postings",
    blurb: "ranked by distinct reporters; remove or restore.",
  },
  {
    href: "/admin/campaigns",
    label: "Ad campaign review",
    permission: "ad_campaigns",
    blurb: "approving never starts a campaign or spends anything.",
  },
] as const;

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
        <EyebrowLabel>What you can reach</EyebrowLabel>
        <p className="max-w-[620px] text-[15px] text-ink-soft">
          Filtered to your role. Since 0075 an operator sees only the areas
          their role grants — the same rule the nav follows, applied here too,
          because a dashboard offering links that bounce is worse than one that
          offers fewer.
        </p>
        {/*
          FILTERED, like the nav — and for the same reason, with the same
          caveat. This is presentation: requirePermission() on each page is
          what actually refuses. Leaving these unfiltered was not a hole (the
          guard still bounced) but it offered links that could only fail, which
          an e2e run caught before anyone had to read one.
        */}
        <ul className="flex list-none flex-col gap-2 p-0 text-[15px]">
          {DASHBOARD_LINKS.filter((l) => admin.permissions.includes(l.permission)).map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="underline">
                {l.label}
              </Link>{" "}
              — {l.blurb}
            </li>
          ))}
          {!DASHBOARD_LINKS.some((l) => admin.permissions.includes(l.permission)) && (
            <li className="font-display italic text-ink-soft">
              Your role grants no areas yet. Whoever invited you can change that
              from Operators.
            </li>
          )}
        </ul>
      </div>

    </Container>
  );
}
