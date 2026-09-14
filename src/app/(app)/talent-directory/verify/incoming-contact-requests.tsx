import { respondToTalentDirectoryContactRequestAction } from "@/lib/talent-directory/actions";
import type { ContactRequest } from "@/lib/talent-directory/queries";
import { BorderedCard, Button } from "@/components/ui";

/**
 * send-157 — candidate-side inbox. Plain bound form actions, no client JS,
 * the same convention posted-job-row.tsx's own Close/Reopen buttons already
 * use: each button binds requestId + approve/decline directly, so there's no
 * client component here at all.
 */
export function IncomingContactRequests({ requests }: { requests: ContactRequest[] }) {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[18px] font-semibold">Interest from employers</h2>
      {pending.map((r) => (
        <BorderedCard key={r.id} className="flex flex-col gap-2.5 p-4">
          <p className="text-[13.5px] font-semibold text-ink">{r.organizationName}</p>
          <p className="text-[13.5px] text-ink-soft">&ldquo;{r.message}&rdquo;</p>
          <p className="text-[12px] text-ink-soft">{new Date(r.createdAt).toLocaleDateString()}</p>
          <div className="flex gap-2">
            <form action={respondToTalentDirectoryContactRequestAction.bind(null, r.id, true)}>
              <Button type="submit" variant="secondary">
                Approve
              </Button>
            </form>
            <form action={respondToTalentDirectoryContactRequestAction.bind(null, r.id, false)}>
              <Button type="submit" variant="text">
                Decline
              </Button>
            </form>
          </div>
        </BorderedCard>
      ))}
      {decided.map((r) => (
        <BorderedCard key={r.id} className="flex flex-col gap-1.5 p-4">
          <p className="text-[13.5px] font-semibold text-ink">{r.organizationName}</p>
          <p className="text-[13px] text-ink-soft">
            {r.status === "approved" ? "You approved this request." : "You declined this request."}
          </p>
        </BorderedCard>
      ))}
    </section>
  );
}
