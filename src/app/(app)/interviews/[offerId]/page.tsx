import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { loadCandidateOffer } from "@/lib/interviews/read";
import { KIND_LABELS, isInterviewKind } from "@/lib/interviews/constants";
import { InterviewPicker } from "@/components/interviews/interview-picker";
import { LocalTime } from "@/components/interviews/local-time";
import { EyebrowLabel } from "@/components/ui";

export const metadata = { title: "Interview — Talentrah" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An interview invitation, for the candidate it is addressed to (the link in the invitation email, opened signed in). Only the person whose application this is can open it: anyone else gets the not-found
 * page. Times are stored in UTC and shown here in the viewer's own zone.
 */
export default async function InterviewInvitationPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const { user } = await requireUser();
  if (!UUID.test(offerId)) notFound();
  const offer = await loadCandidateOffer(offerId, user.id);
  if (!offer) notFound();

  const kind = isInterviewKind(offer.kind) ? KIND_LABELS[offer.kind] : offer.kind;
  const booked = offer.booking?.status === "booked" ? offer.booking : null;

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-10">
      <div>
        <Link href="/tracker" className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust">
          ← Job Tracker
        </Link>
        <div className="mt-4">
          <EyebrowLabel>Interview</EyebrowLabel>
        </div>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          {offer.orgName} · {offer.jobTitle}
        </h1>
        <p className="mt-2 font-body text-[14px] text-ink-soft">{kind}</p>
        {offer.note && <p className="mt-3 border-l-[3px] border-rust pl-4 font-body text-[15px] text-ink">{offer.note}</p>}
      </div>

      {booked ? (
        <div className="border-[1.5px] border-ink bg-card p-6">
          <p className="font-display text-[22px] font-medium text-ink">Interview scheduled</p>
          <p className="mt-2 font-body text-[16px] text-ink">
            <LocalTime startsAt={booked.startsAt} durationMinutes={booked.durationMinutes} />
          </p>
          <p className="mt-2 font-body text-[13.5px] text-ink-soft">Shown in your own time zone. A calendar file was emailed to you.</p>
        </div>
      ) : offer.state === "open" ? (
        <div>
          <p className="mb-3 font-body text-[14px] text-ink-soft">Choose the time that suits you. Times are shown in your own time zone.</p>
          <InterviewPicker offerId={offer.offerId} slots={offer.slots} />
        </div>
      ) : offer.booking?.status === "cancelled" ? (
        <p className="border-[1.5px] border-ink bg-paper-alt px-4 py-3 font-body text-[14px] text-ink">This interview has been cancelled.</p>
      ) : offer.state === "expired" ? (
        <p className="border-[1.5px] border-ink bg-paper-alt px-4 py-3 font-body text-[14px] text-ink">These times have all passed, so this invitation has expired. You can ask the employer to offer new times.</p>
      ) : (
        <p className="border-[1.5px] border-ink bg-paper-alt px-4 py-3 font-body text-[14px] text-ink">This invitation is no longer open.</p>
      )}
    </div>
  );
}
