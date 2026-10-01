import { requireUser } from "@/lib/auth/require-user";
import { sessionsAsMentee } from "@/lib/mentorship/queries";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ReviewForm } from "./review-form";
import { Button } from "@/components/ui";
import { cancelUnpaidMentorSessionAction, payForMentorSessionAction } from "@/lib/mentorship/actions";
import { bucketSession, sessionStatusLabel } from "@/lib/mentorship/session-buckets";
import { UNPAID_HOLD_NOTICE } from "@/lib/mentorship/unpaid-hold";
import { formatDateTime } from "@/lib/format/datetime";

export const metadata = { title: "Your mentorship sessions — Talentrah" };

/** The mentee side of session lifecycle (send-137, build-prompt §6.11 v1 slice). */
export default async function MentorshipSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string; error?: string }>;
}) {
  const { user } = await requireUser();
  const [sessions, { booked, error }] = await Promise.all([sessionsAsMentee(user.id), searchParams]);

  /*
   * send-497: Upcoming is paid-or-confirmed sessions that have not ended; an unpaid booking still ahead has its own
   * section; an unpaid booking whose slot has started is past ("Not paid — the slot has passed"). This used to be "everything that
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
      {error && <p className="text-[13.5px] text-rust">{error}</p>}
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
                {formatDateTime(s.scheduledStart)} · {sessionStatusLabel(s.status, s.scheduledStart, now, "mentee", s.createdAt)}
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
                {formatDateTime(s.scheduledStart)} · {sessionStatusLabel(s.status, s.scheduledStart, now, "mentee", s.createdAt)}
              </p>
              <p className="text-[13.5px] text-ink">{UNPAID_HOLD_NOTICE}</p>
              {/*
                Pay and Cancel (send-502). Only here: these are the rows that can still be paid for. Pay sends the mentee to
                Paystack for the booking's own price; Cancel releases the slot. Both are real form submits.
              */}
              <div className="flex flex-wrap items-center gap-3">
                <form action={payForMentorSessionAction.bind(null, s.id)}>
                  <Button type="submit" variant="primary" size="sm">
                    Pay ₦{s.priceNgn.toLocaleString("en-NG")}
                  </Button>
                </form>
                <form action={cancelUnpaidMentorSessionAction.bind(null, s.id)}>
                  <Button type="submit" variant="secondary" size="sm">
                    Cancel booking
                  </Button>
                </form>
              </div>
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
                {formatDateTime(s.scheduledStart)} · {sessionStatusLabel(s.status, s.scheduledStart, now, "mentee", s.createdAt)}
              </p>
              {s.status === "completed" && <ReviewForm sessionId={s.id} mentorId={s.mentorId} />}
            </BorderedCard>
          ))
        )}
      </section>
    </Container>
  );
}
