import { requirePermission } from "@/lib/admin/require-admin";
import { QueueHeader } from "@/components/admin/queue-chrome";
import { JobsImportPanel } from "@/components/admin/jobs-import-panel";
import { Container } from "@/components/ui";

export const metadata = {
  title: "Jobs import — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Upload a CSV of jobs (the same 17 columns as the jobs sheet), preview it, confirm it. The permission `jobs_import` is checked HERE, in the page itself (the nav hides the link from
 * everyone else, which is a courtesy and not the control), and again in each of the two route handlers the panel posts to. See docs/admin-jobs-import.md.
 */
export default async function JobsImportPage() {
  const admin = await requirePermission("jobs_import");
  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Jobs import"
        title="Add jobs from a sheet."
        blurb="Choose a CSV, read the preview, then confirm. Rows go live on the public feed at once; a job already on Talentrah is skipped, never changed."
        adminLabel={admin.displayName || admin.email}
      />
      <JobsImportPanel />
    </Container>
  );
}
