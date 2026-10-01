import { requireUser } from "@/lib/auth/require-user";
import { sessionsAsMentee } from "@/lib/mentorship/queries";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ReviewForm } from "./review-form";
import { bucketSession, sessionStatusLabel } from "@/lib/mentorship/session-buckets";

export const metadata = { title: "Your mentorship sessions — Talentrah" };

/** The mentee side of session lifecycle (send-137, build-prompt §6.11 v1 slice). */
export default async function MentorshipSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  const { user } = await requireUser();
  const [sessions, { booked }] = await Promise.all([sessionsAsMentee(user.id), searchParams]);

  /*
   * send-497: Upcoming is paid-or-confirmed sessions that have not ended; an unpaid booking still ahead has its own
   * section; an unpaid booking whose slot has started is past ("Expired — not paid"). This used to be "everything that
   * is not completed, cancelled or refunded", which kept a 17 Sep unpaid booking under Upcoming for two weeks.
   */
  const now = new Date();
  const upcoming = sessions.filter((s) => bucketSession(s, now) === "upcoming");
  const awaitingPayment = sessions.filter((s) => bucketSession(s, now) === "awaiting_payment");
  const past = sessions.filter((s) => bucketSession(s, now) === "past");

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <EyebrowLabel>Mentorship</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Your sessions</h1>
      {booked && (
        <p className="text-[13.5px] text-green">
          Booked — you&apos;ll see the meeting link here once your mentor confirms.
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-[18px] font-semibold">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-[14px] text-ink-soft">No upcoming sessions.</p>
        ) : (
          upcoming.map((s) => (
            <BorderedCard key={s.id} className="flex flex-col gap-2 p-5">
              <p className="font-semibold text-ink">{s.mentorName} · {s.sessionType.replace(/_/g, " ")}</p>
              <p className="text-[13.5px] text-ink-soft">
                {new Date(s.scheduledStart).toLocaleString()} · {sessionStatusLabel(s.status, s.scheduledStart, now)}
              </p>
              {s.meetingLink && (
                <a href={s.meetingLink} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-rust">
                  Join meeting ↗
                </a>
              )}
            </BorderedCard>
          ))
        )}
      </section>

      {awaitingPayment.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-[18px] font-semibold">Awaiting payment</h2>
          {awaitingPayment.map((s) => (
            <BorderedCard key={s.id} className="flex flex-col gap-2 p-5">
              <p className="font-semibold text-ink">{s.mentorName} · {s.sessionType.replace(/_/g, " ")}</p>
              <p className="text-[13.5px] text-ink-soft">
                {new Date(s.scheduledStart).toLocaleString()} · {sessionStatusLabel(s.status, s.scheduledStart, now)}
              </p>
            </BorderedCard>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-[18px] font-semibold">Past</h2>
        {past.length === 0 ? (
          <p className="text-[14px] text-ink-soft">No past sessions yet.</p>
        ) : (
          past.map((s) => (
            <BorderedCard key={s.id} className="flex flex-col gap-2 p-5">
              <p className="font-semibold text-ink">{s.mentorName} · {s.sessionType.replace(/_/g, " ")}</p>
              <p className="text-[13.5px] text-ink-soft">
                {new Date(s.scheduledStart).toLocaleString()} · {sessionStatusLabel(s.status, s.scheduledStart, now)}
              </p>
              {s.status === "completed" && <ReviewForm sessionId={s.id} mentorId={s.mentorId} />}
            </BorderedCard>
          ))
        )}
      </section>
    </Container>
  );
}
