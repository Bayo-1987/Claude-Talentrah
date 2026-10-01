import { requireUser } from "@/lib/auth/require-user";
import { sessionsAsMentor } from "@/lib/mentorship/queries";
import { confirmMentorSessionAction } from "@/lib/mentorship/actions";
import { Container, EyebrowLabel, BorderedCard, Button } from "@/components/ui";
import { bucketSession, sessionStatusLabel } from "@/lib/mentorship/session-buckets";
import { formatDateTime } from "@/lib/format/datetime";

export const metadata = { title: "Your mentees — Talentrah" };

/**
 * The mentor side of session lifecycle. `confirmMentorSessionAction`
 * generates the Jitsi meeting link at confirmation, matching 0133's own
 * `awaiting_confirmation → confirmed` transition.
 */
export default async function MentorSessionsPage() {
  const { user } = await requireUser();
  const sessions = await sessionsAsMentor(user.id);

  /*
   * Same rule as the mentee's page (send-497): paid sessions that have not ended are upcoming, an unpaid booking still
   * ahead is "awaiting payment", an unpaid booking whose slot has started is past. A paid session still waiting on the
   * mentor needs confirming only while it is ahead; once its slot has passed it is past.
   */
  const now = new Date();
  const bucket = (s: (typeof sessions)[number]) => bucketSession(s, now);
  const needsConfirmation = sessions.filter((s) => s.status === "awaiting_confirmation" && bucket(s) === "upcoming");
  const upcoming = sessions.filter((s) => s.status !== "awaiting_confirmation" && bucket(s) === "upcoming");
  const awaitingPayment = sessions.filter((s) => bucket(s) === "awaiting_payment");
  const past = sessions.filter((s) => bucket(s) === "past");

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
                <BorderedCard key={s.id} className="flex flex-col gap-2 p-5">
                  <p className="font-semibold text-ink">{s.menteeName} · {s.sessionType.replace(/_/g, " ")}</p>
                  <p className="text-[13.5px] text-ink-soft">
                    {formatDateTime(s.scheduledStart)}
                  </p>
                  <p className="text-[12.5px] text-amber">
                    Confirm within 24 hours of the scheduled time or this booking auto-cancels and any payment is refunded.
                  </p>
                  <form action={confirm}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <Button type="submit" variant="primary" size="sm">Confirm</Button>
                  </form>
                </BorderedCard>
              ))}
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[18px] font-semibold">Upcoming</h2>
              {upcoming.map((s) => (
                <SessionRow key={s.id} s={s} now={now} />
              ))}
            </section>
          )}

          {awaitingPayment.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[18px] font-semibold">Awaiting payment</h2>
              {awaitingPayment.map((s) => (
                <SessionRow key={s.id} s={s} now={now} />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="font-display text-[18px] font-semibold">Past</h2>
              {past.map((s) => (
                <SessionRow key={s.id} s={s} now={now} />
              ))}
            </section>
          )}
        </>
      )}
    </Container>
  );
}

function SessionRow({ s, now }: { s: Awaited<ReturnType<typeof sessionsAsMentor>>[number]; now: Date }) {
  return (
    <BorderedCard className="flex flex-col gap-2 p-5">
      <p className="font-semibold text-ink">{s.menteeName} · {s.sessionType.replace(/_/g, " ")}</p>
      <p className="text-[13.5px] text-ink-soft">
        {formatDateTime(s.scheduledStart)} · {sessionStatusLabel(s.status, s.scheduledStart, now, "mentor", s.createdAt)}
      </p>
      {s.meetingLink && (
        <a href={s.meetingLink} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-rust">
          Join meeting ↗
        </a>
      )}
    </BorderedCard>
  );
}
