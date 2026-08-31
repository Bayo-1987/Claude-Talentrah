import { requirePermission } from "@/lib/admin/require-admin";
import { courseCatalog } from "@/lib/admin/catalog/courses";
import { CourseRowForm } from "@/components/admin/course-row-form";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

export const metadata = {
  title: "Course catalog — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * The course catalog, editable.
 *
 * 0061's header named this gap: "adding a row is a SQL insert until the admin
 * dashboard grows a screen for it".
 *
 * NOT A QUEUE. The other four screens show work waiting and empty as it is
 * cleared; this is a nine-row list that is never done, so it shows every row
 * including inactive ones. The public matcher filters `active = true` and this
 * deliberately does not — the switched-off rows are the ones an operator came
 * here to deal with.
 *
 * WHAT IS ABSENT: adding and deleting. Editing and toggling cover what the
 * catalog needs today, and a delete button on a table whose click log
 * references its rows is a decision about telemetry, not a missing feature —
 * `course_recommendation_clicks.recommendation_id` is ON DELETE SET NULL, so
 * deleting a course silently detaches its history. `active` is the soft-delete
 * 0061 built for exactly this, and it keeps that history intact.
 */
export default async function CourseCatalogPage() {
  const admin = await requirePermission("courses");
  const catalog = await courseCatalog();

  const placeholders = catalog.filter((c) => c.isPlaceholder).length;
  const live = catalog.filter((c) => c.active).length;

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Course catalog"
        title="What we recommend, and whether it is live."
        blurb="Every row, active and inactive — the public matcher only shows active ones, this page shows all of them. Editing is immediate; there is no review step, because this catalog is curated rather than submitted."
        adminLabel={admin.displayName || admin.email}
      />

      <BorderedCard className="flex flex-col gap-2 p-5">
        <EyebrowLabel>Status</EyebrowLabel>
        <p className="text-[15px]">
          {live} of {catalog.length} live
          {placeholders > 0 && ` · ${placeholders} still on placeholder links`}
        </p>
        {placeholders > 0 && (
          /*
            The single most important sentence on this page. 0063 switched
            these rows off precisely so un-earning links never reach users, and
            a screen with a one-click "make live" would undo that decision the
            first time somebody tidied up. The guard is enforced in the action;
            this says why, so the refusal reads as a rule rather than a bug.
          */
          <p className="max-w-[640px] font-display text-[14.5px] italic text-ink-soft">
            Rows carrying <code className="not-italic">?ref=talentrah-placeholder</code> cannot
            be made live — the link earns nothing, so publishing it would send people
            through a broken referral. Replace the URL with a real affiliate code
            and the row becomes activatable. Getting those codes is a founder
            action (§10 item 1), not a code change.
          </p>
        )}
      </BorderedCard>

      <ul className="flex list-none flex-col gap-5 p-0">
        {catalog.map((c) => (
          <li key={c.id}>
            <BorderedCard className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <EyebrowLabel>
                  {c.skillTag} · {c.provider}
                </EyebrowLabel>
                <span className="text-[12.5px] text-ink-soft">
                  {c.active ? "Live" : "Not offered"}
                  {c.isPlaceholder && " · placeholder link"}
                  {c.clicks > 0 && ` · ${c.clicks} click${c.clicks === 1 ? "" : "s"}`}
                </span>
              </div>

              <CourseRowForm course={c} />
            </BorderedCard>
          </li>
        ))}
      </ul>
    </Container>
  );
}
