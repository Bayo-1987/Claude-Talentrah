import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PersonLookup } from "@/components/admin/person-lookup";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Look up a person — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Support tooling for one billing question about one person.
 *
 * REACHED DELIBERATELY, not browsed into. There is no list on this page and no
 * link to one anywhere, because none exists: `findPerson` resolves exactly one
 * of three identifiers or nothing. "The operator should not go fishing" is a
 * property of the code here rather than a convention someone is trusted to
 * keep.
 *
 * THE NOTICE ABOVE THE BOX IS DOING REAL WORK. The audit entry is what lets a
 * question be answered after the fact; the sentence telling an operator their
 * lookup is recorded is what changes whether the casual one happens at all.
 * Removing it would leave the log intact and the deterrent gone, which is the
 * half that actually protects anyone.
 */
export default async function PersonLookupPage() {
  const admin = await requireAdmin();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Support lookup"
        title="One person, one billing question."
        blurb="For a real case — “where did my payment go”, a disputed charge. Billing records only: no resumes, no applications, no tailoring history."
        adminLabel={admin.displayName || admin.email}
      />

      <BorderedCard className="border-ink bg-rust-soft p-4">
        <p className="text-[14px] text-ink">
          <strong>Opening a record is recorded.</strong> A successful lookup writes{" "}
          <code className="text-[13px]">person.viewed</code> to the admin audit log against your
          account and the person&apos;s id. Searches that match nobody are not recorded.
        </p>
      </BorderedCard>

      <PersonLookup />

      <p className="text-[14px] text-ink-soft">
        Looking for totals rather than a person?{" "}
        <Link href="/admin/finance" className="underline">
          Financial health
        </Link>{" "}
        carries no personal data.
      </p>
    </Container>
  );
}
