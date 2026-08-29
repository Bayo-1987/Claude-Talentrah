import Link from "next/link";
import { adminLogoutAction } from "@/lib/admin/actions";
import { Container } from "@/components/ui";
import { buttonClasses } from "@/lib/button-classes";

/**
 * The admin bar. Not the seeker masthead and not a variant of it — CLAUDE.md's
 * rule that the masthead doubles as app nav is about the consumer product, and
 * an operator here is not a job seeker. Sharing that component would put the
 * job-seeker links (Jobs, Job Tracker, Resume Builder) above a moderation
 * queue.
 *
 * It carries exactly one thing beyond the wordmark: who you are signed in as.
 * That is the point of the milestone made visible — an operator who cannot see
 * which identity they are acting under has no reason to believe the audit
 * trail either.
 */
export function AdminMasthead({
  email,
  displayName,
}: {
  email: string;
  displayName: string | null;
}) {
  return (
    <header className="border-b border-line bg-paper-alt">
      <Container className="flex min-h-[64px] flex-wrap items-center justify-between gap-4 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/admin" className="font-display text-[20px] no-underline">
            Talentrah
          </Link>
          <span className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Admin
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[13.5px] text-ink-soft">{displayName || email}</span>
          {/*
            A form, not a link. Signing out revokes a row in the database, and
            a GET that changes state is a thing another site can make the
            browser do.
          */}
          <form action={adminLogoutAction}>
            <button type="submit" className={buttonClasses("secondary", "sm")}>
              Sign out
            </button>
          </form>
        </div>
      </Container>
    </header>
  );
}
