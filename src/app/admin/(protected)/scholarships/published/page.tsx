import Link from "next/link";
import { requirePermission } from "@/lib/admin/require-admin";
import { publishedScholarships } from "@/lib/admin/moderation/queues";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";
import { QueueEmpty } from "@/components/admin/queue-chrome";
import { formatDate } from "@/lib/format/datetime";

export const metadata = {
  title: "Published scholarships — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Published listings (owner row, 8 Oct 2026): each can be edited from here. Saving an edit that changes a published listing takes it off the site until it is re-approved, and the
 * edit page says so BEFORE the operator saves.
 *
 * This is its own page, NOT a section of the review queue: the queue's approve flow expects an approved card to leave /admin/scholarships, and a published list on the same page would keep
 * it there under the same heading.
 */
export default async function PublishedScholarshipsPage() {
  await requirePermission("scholarships");
  const published = await publishedScholarships();

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Published listings</EyebrowLabel>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="text-[30px] leading-[1.2]">Live in the public catalog.</h1>
          <Link href="/admin/scholarships" className={buttonClasses("secondary", "sm")}>
            Back to the review queue
          </Link>
        </div>
        <p className="max-w-[640px] text-[15px] text-ink-soft">
          Editing a published listing takes it off the site until it is approved again. The edit page says so before you save.
        </p>
      </div>

      {published.length === 0 ? (
        <QueueEmpty>Nothing published yet.</QueueEmpty>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {published.map((s) => (
            <li key={s.id}>
              <BorderedCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <EyebrowLabel>{s.provider}</EyebrowLabel>
                  <h2 className="font-display text-[17px] font-semibold leading-snug">{s.programName}</h2>
                  <p className="text-[13px] text-ink-soft">Deadline {s.deadline ? formatDate(s.deadline) : "not stated"}</p>
                </div>
                <Link href={`/admin/scholarships/${s.id}/edit`} className={buttonClasses("secondary", "sm")}>
                  Edit
                </Link>
              </BorderedCard>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
