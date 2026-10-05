import { BorderedCard, Button, EyebrowLabel } from "@/components/ui";
import {
  TALENT_DIRECTORY_MAX_SAMPLES,
  TALENT_DIRECTORY_MIN_LISTED,
  buildingTheDirectoryMessage,
  isAre,
  isSubscriptionOpen,
  listedProgress,
  candidatesWithReviewedResume,
  WAITLIST_FREE_NOTE,
  type PreviewSample,
  type TalentDirectoryPreview,
} from "@/lib/talent-directory/preview";

export interface PreviewPlan {
  id: string;
  name: string;
  price_ngn: number;
}

/**
 * What an employer with no active subscription sees on /employer/talent-directory (EMP-1 / E1).
 *
 * The live count of verified, opted-in candidates, up to three anonymised sample cards, and then ONE of two things: below
 * TALENT_DIRECTORY_MIN_LISTED, a free waitlist and NO Subscribe button; at or above it, the normal Subscribe flow, unchanged. The
 * plan price is whatever the plan row says (read by the page), never a literal here.
 *
 * The sample cards carry no photo, no link and no avatar, by design (the anonymisation rules are enforced in SQL, migration 0206; this
 * component only draws what the parser let through). Everything here is a server-renderable element: the only client piece is Button.
 */
export function TalentDirectoryPreviewPanel({
  preview,
  plans,
  joinedWaitlist,
  joinAction,
  purchaseAction,
}: {
  preview: TalentDirectoryPreview;
  plans: PreviewPlan[];
  joinedWaitlist: boolean;
  joinAction: () => Promise<void>;
  purchaseAction: (planId: string) => Promise<void>;
}) {
  const open = isSubscriptionOpen(preview.count);
  const samples = preview.samples.slice(0, TALENT_DIRECTORY_MAX_SAMPLES);

  return (
    <div className="flex flex-col gap-6">
      {samples.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="Sample profiles">
          <EyebrowLabel>Sample profiles</EyebrowLabel>
          <p className="text-[13px] text-ink-soft">
            Anonymised: names, employers and contact details are never shown on a sample.
          </p>
          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3">
            {samples.map((sample, i) => (
              <li key={i} data-testid="preview-sample">
                <SampleCard sample={sample} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BorderedCard className="flex flex-col gap-4 p-6">
        {open ? (
          <>
            <p className="text-[14.5px] font-semibold text-ink">{`${candidatesWithReviewedResume(preview.count)} ${isAre(preview.count)} listed.`}</p>
            <p className="text-[14.5px] text-ink-soft">
              Subscribe to search opted-in seekers with a reviewed resume by availability and remote-readiness.
            </p>
            {plans.map((plan) => (
              <form key={plan.id} action={purchaseAction.bind(null, plan.id)}>
                <Button type="submit" variant="primary">
                  {`Subscribe — ${plan.name} (₦${plan.price_ngn.toLocaleString("en-NG")}/mo)`}
                </Button>
              </form>
            ))}
          </>
        ) : joinedWaitlist ? (
          <>
            <p className="text-[14.5px] font-semibold text-ink">{`You're on the waitlist.`}</p>
            <ListedProgress count={preview.count} />
            <p className="text-[14.5px] text-ink-soft">
              {`${candidatesWithReviewedResume(preview.count)} ${isAre(preview.count)} listed so far. We'll tell you when ${TALENT_DIRECTORY_MIN_LISTED}+ are listed. ${WAITLIST_FREE_NOTE}`}
            </p>
          </>
        ) : (
          <>
            <p className="text-[14.5px] text-ink-soft">{buildingTheDirectoryMessage(preview.count)}</p>
            <ListedProgress count={preview.count} />
            <form action={joinAction}>
              <Button type="submit" variant="primary">
                Join the waitlist
              </Button>
            </form>
          </>
        )}
      </BorderedCard>
    </div>
  );
}

/** "N of 10 verified candidates listed": the text, and the same fact as a progressbar. Square, flat and ink-bordered, like every box here. */
function ListedProgress({ count }: { count: number }) {
  const progress = listedProgress(count);
  return (
    <div className="flex flex-col gap-2">
      <p id="td-listed-progress-label" className="text-[13px] font-semibold text-ink">
        {progress.text}
      </p>
      <div
        role="progressbar"
        aria-labelledby="td-listed-progress-label"
        aria-valuemin={0}
        aria-valuemax={progress.max}
        aria-valuenow={progress.now}
        aria-valuetext={progress.text}
        className="h-3 w-full border-[1.5px] border-ink bg-card"
      >
        <div data-testid="listed-progress-fill" className="h-full bg-ink" style={{ width: `${progress.pct}%` }} />
      </div>
    </div>
  );
}

function SampleCard({ sample }: { sample: PreviewSample }) {
  const availability = [sample.availableForHire && "Available now", sample.remoteReady && "Remote-ready"].filter(Boolean);
  return (
    <BorderedCard className="flex h-full flex-col gap-2 p-5">
      <h3 className="font-display text-[17px] font-semibold text-ink">{sample.role}</h3>
      {sample.yearsBand && <p className="text-[13px] text-ink-soft">{`${sample.yearsBand} years`}</p>}
      {sample.skills.length > 0 && <p className="text-[13px] text-ink-soft">{sample.skills.join(", ")}</p>}
      {availability.length > 0 && <p className="text-[12.5px] font-semibold text-green">{availability.join(" · ")}</p>}
    </BorderedCard>
  );
}
