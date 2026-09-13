import { requireUser } from "@/lib/auth/require-user";
import { sessionsAsMentor } from "@/lib/mentorship/queries";
import { confirmMentorSessionAction } from "@/lib/mentorship/actions";
import { Container, EyebrowLabel, Card, Button } from "@/components/ui";

export const metadata = { title: "Your mentees — Talentrah" };

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting the mentee's payment",
  awaiting_confirmation: "Awaiting your confirmation",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_mentor_no_confirm: "Auto-cancelled — you didn't confirm in time",
  refunded: "Refunded",
};

/**
 * The mentor side of session lifecycle. `confirmMentorSessionAction`
 * generates the Jitsi meeting link at confirmation, matching 0133's own
 * `awaiting_confirmation → confirmed` transition.
 */
export default async function MentorSessionsPage() {
  const { user } = await requireUser();
  const sessions = await sessionsAsMentor(user.id);

  const needsConfirmation = sessions.filter((s) => s.status === "awaiting_confirmation");
  const rest = sessions.filter((s) => s.status !== "awaiting_confirmation");

  async function confirm(formData: FormData) {
    "use server";
    await confirmMentorSessionAction(String(formData.get("sessionId")));
  }

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <EyebrowLabel>Mentorship</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Your mentees</h1>

      {sessions.length === 0 ? (
        <p className="text-[14px] text-ink-soft">No sessions booked with you yet.</p>
      ) : (
        <>
          {needsConfirmation.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[18px] font-semibold">Needs your confirmation</h2>
              {needsConfirmation.map((s) => (
                <Card key={s.id} className="flex flex-col gap-2 p-5">
                  <p className="font-semibold text-ink">{s.menteeName} · {s.sessionType.replace(/_/g, " ")}</p>
                  <p className="text-[13.5px] text-ink-soft">
                    {new Date(s.scheduledStart).toLocaleString()}
                  </p>
                  <p className="text-[12.5px] text-amber">
                    Confirm within 24 hours of the scheduled time or this booking auto-cancels and any payment is refunded.
                  </p>
                  <form action={confirm}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <Button type="submit" variant="primary" size="sm">Confirm</Button>
                  </form>
                </Card>
              ))}
            </section>
          )}

          <section className="flex flex-col gap-4">
            <h2 className="font-display text-[18px] font-semibold">Everything else</h2>
            {rest.map((s) => (
              <Card key={s.id} className="flex flex-col gap-2 p-5">
                <p className="font-semibold text-ink">{s.menteeName} · {s.sessionType.replace(/_/g, " ")}</p>
                <p className="text-[13.5px] text-ink-soft">
                  {new Date(s.scheduledStart).toLocaleString()} · {STATUS_LABEL[s.status] ?? s.status}
                </p>
                {s.meetingLink && (
                  <a href={s.meetingLink} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-coral">
                    Join meeting ↗
                  </a>
                )}
              </Card>
            ))}
          </section>
        </>
      )}
    </Container>
  );
}
