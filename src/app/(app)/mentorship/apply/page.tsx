import { requireUser } from "@/lib/auth/require-user";
import { getOwnMentorProfile, getOwnAvailabilitySlots, getOwnPayoutDetails } from "@/lib/mentorship/queries";
import { listBanksForForm } from "@/lib/mentorship/payout-details";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ApplicationForm } from "./application-form";
import { AvailabilityManager } from "./availability-manager";
import { PayoutDetailsForm } from "./payout-details-form";

export const metadata = { title: "Become a mentor — Talentrah" };

const STATUS_COPY: Record<string, string> = {
  pending: "Your application is awaiting review.",
  approved: "You're an approved mentor — you're listed in Mentorship.",
  rejected: "Your application was not approved.",
  suspended: "Your mentor listing is currently suspended.",
};

/**
 * Mentor onboarding & vetting's seeker-facing half (send-137, build-prompt
 * §6.11 v1 slice). The application form and, once approved, availability
 * management both live here — one page for the whole mentor-facing lifecycle
 * rather than splitting it, since a pending applicant has nothing else to do
 * here yet and an approved one only gains the availability section.
 *
 * §2.5'S DUAL-ROLE FLYWHEEL: this page works identically whether or not the
 * signed-in user has ever applied for a job on Talentrah — mentor_profiles is
 * keyed to profiles.id, not the other way around, so nothing here needs to
 * check or care about the person's seeker history.
 */
export default async function MentorApplyPage() {
  const { user } = await requireUser();
  const profile = await getOwnMentorProfile(user.id);

  const slots = profile?.status === "approved" ? await getOwnAvailabilitySlots(user.id) : [];
  const payoutDetails = profile?.status === "approved" ? await getOwnPayoutDetails(user.id) : null;
  const { banks, error: banksError } =
    profile?.status === "approved" ? await listBanksForForm() : { banks: [], error: null };

  return (
    <Container className="flex max-w-[640px] flex-col gap-8 py-12">
      <EyebrowLabel>Mentorship</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">
        {profile ? "Your mentor profile" : "Become a mentor"}
      </h1>

      {profile ? (
        <>
          <BorderedCard className="flex flex-col gap-3 p-5">
            <p className="text-[14px] text-ink">{STATUS_COPY[profile.status] ?? profile.status}</p>
            {profile.status === "rejected" && profile.reviewNote && (
              <p className="text-[13px] text-ink-soft">Reviewer note: {profile.reviewNote}</p>
            )}
          </BorderedCard>
          <ApplicationForm existing={profile} />
          {profile.status === "approved" && (
            <>
              <AvailabilityManager slots={slots} />
              <PayoutDetailsForm existing={payoutDetails} banks={banks} banksError={banksError} />
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-[14.5px] text-ink-soft">
            Free and volunteer mentors are a real, permanent option here — not
            just a bootstrap. Leave the price field blank if that&apos;s you.
          </p>
          <ApplicationForm existing={null} />
        </>
      )}
    </Container>
  );
}
