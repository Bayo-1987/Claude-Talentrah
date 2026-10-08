import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/admin/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isEditableStatus } from "@/lib/scholarships/admin-edit";
import { Container, EyebrowLabel } from "@/components/ui";
import { EditScholarshipForm, type EditInitial } from "./edit-scholarship-form";

export const metadata = {
  title: "Edit a scholarship — Talentrah admin",
  robots: { index: false, follow: false },
};

const COLUMNS =
  "id, moderation_status, provider, program_name, host_institution, degree_levels, field_tags, funding_type, funding_covers, eligibility_nationalities, eligibility_prior_degree, eligibility_age, eligibility_other, application_deadline, cycle_year, official_url, source_name, deadline_note";

/**
 * Edit a scholarship listing (owner, 8 Oct 2026): the add-by-hand form, pre-filled, for a pending or a published listing. The page guard protects the page; the action
 * (updateScholarshipAction) checks the same permission itself. A rejected listing is not editable and says so.
 */
export default async function EditScholarshipPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("scholarships");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const { data: s, error } = await createServiceRoleClient().from("scholarships").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!s) notFound();

  const initial: EditInitial = {
    provider: s.provider,
    programName: s.program_name,
    hostInstitution: s.host_institution ?? "",
    degreeLevels: s.degree_levels as string[],
    fieldTags: (s.field_tags ?? []).join(", "),
    fundingType: s.funding_type,
    fundingCovers: (s.funding_covers ?? []).join(", "),
    eligibilityNationalities: (s.eligibility_nationalities ?? []).join(", "),
    eligibilityPriorDegree: s.eligibility_prior_degree ?? "",
    eligibilityAge: s.eligibility_age ?? "",
    eligibilityOther: s.eligibility_other ?? "",
    applicationDeadline: s.application_deadline ?? "",
    cycleYear: s.cycle_year ? String(s.cycle_year) : "",
    officialUrl: s.official_url,
    sourceName: s.source_name ?? "",
    deadlineNote: s.deadline_note ?? "",
    reviewNote: "",
  };

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Scholarship admin</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Edit a listing.</h1>
        <p className="max-w-[620px] text-[15px] text-ink-soft">
          {s.program_name} · {s.provider}
        </p>
      </div>
      {isEditableStatus(s.moderation_status) ? (
        <EditScholarshipForm id={s.id} published={s.moderation_status === "verified"} initial={initial} />
      ) : (
        <p className="max-w-[620px] border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[14px] text-ink">
          This listing was rejected, so it can&apos;t be edited. Add it again from{" "}
          <Link href="/admin/scholarships/new" className="underline">
            Add one by hand
          </Link>{" "}
          if it should be reconsidered.
        </p>
      )}
    </Container>
  );
}
