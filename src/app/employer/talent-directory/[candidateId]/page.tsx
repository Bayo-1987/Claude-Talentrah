import { notFound } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import {
  getCandidatePortfolioItems,
  getOwnContactRequestStatus,
  searchTalentDirectory,
} from "@/lib/talent-directory/queries";
import { EyebrowLabel, BorderedCard } from "@/components/ui";
import { ContactRequestForm } from "./contact-request-form";

export const metadata = { title: "Candidate — Talent Directory" };

/**
 * Candidate detail. Both reads go through the SAME SECURITY DEFINER
 * functions the listing page uses — there is no separate, wider read path
 * here just because this page knows a specific id. `talent_directory_search`
 * itself re-checks verified+opt-in and the caller's own subscription, so a
 * guessed or stale candidate id that no longer qualifies renders exactly the
 * same as one that never existed.
 */
export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { organization } = await requireEmployer();
  const { candidateId } = await params;

  const [matches, portfolioItems, contactStatus] = await Promise.all([
    searchTalentDirectory({ candidateId }),
    getCandidatePortfolioItems(candidateId),
    getOwnContactRequestStatus(organization.id, candidateId),
  ]);
  const candidate = matches[0];
  if (!candidate) notFound();

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">
        {[candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "A Talentrah candidate"}
      </h1>
      <p className="text-[14px] text-ink-soft">
        {candidate.country ?? "Location not given"}
        {candidate.remoteReady && " · Remote-ready"}
        {candidate.availableForHire && " · Available now"}
        {candidate.earliestStartDate && ` · Earliest start ${candidate.earliestStartDate}`}
      </p>
      {candidate.verificationScore != null && (
        <p className="text-[13px] font-semibold text-green">Verified — {candidate.verificationScore}/100</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[18px] font-semibold">Contact</h2>
        {contactStatus === "pending" && (
          <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-ink-soft">
            Request pending — you&apos;ll be notified by email once they decide.
          </p>
        )}
        {contactStatus === "approved" && (
          <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-green">
            Approved — check your email for their contact details.
          </p>
        )}
        {contactStatus === "declined" && (
          <p className="border-[1.5px] border-ink bg-card px-3.5 py-2.5 text-[13.5px] text-ink-soft">
            They declined this request. You can send a new one below.
          </p>
        )}
        {contactStatus !== "pending" && <ContactRequestForm candidateId={candidateId} />}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[18px] font-semibold">Work samples</h2>
        {portfolioItems.length === 0 ? (
          <p className="text-[13.5px] text-ink-soft">No work samples added.</p>
        ) : (
          portfolioItems.map((item) => (
            <BorderedCard key={item.id} className="flex flex-col gap-1.5 p-4">
              <p className="font-body text-[13.5px] font-semibold text-ink">{item.title}</p>
              {item.description && <p className="text-[13px] text-ink-soft">{item.description}</p>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-rust">
                  {item.url}
                </a>
              )}
            </BorderedCard>
          ))
        )}
      </section>
    </div>
  );
}
