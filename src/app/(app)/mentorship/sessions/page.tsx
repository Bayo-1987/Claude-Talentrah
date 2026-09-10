import { requireUser } from "@/lib/auth/require-user";
import { sessionsAsMentee } from "@/lib/mentorship/queries";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Your mentorship sessions — Talentrah" };

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  awaiting_confirmation: "Waiting on the mentor to confirm",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled_mentor_no_confirm: "Cancelled — mentor didn't confirm in time",
  refunded: "Refunded",
};

/** The mentee side of session lifecycle (send-137, build-prompt §6.11 v1 slice). */
export default async function MentorshipSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>;
}) {
  const { user } = await requireUser();
  const [sessions, { booked }] = await Promise.all([sessionsAsMentee(user.id), searchParams]);

  const upcoming = sessions.filter((s) => !["completed", "cancelled_mentor_no_confirm", "refunded"].includes(s.status));
  const past = sessions.filter((s) => ["completed", "cancelled_mentor_no_confirm", "refunded"].includes(s.status));

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
                {new Date(s.scheduledStart).toLocaleString()} · {STATUS_LABEL[s.status] ?? s.status}
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

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-[18px] font-semibold">Past</h2>
        {past.length === 0 ? (
          <p className="text-[14px] text-ink-soft">No past sessions yet.</p>
        ) : (
          past.map((s) => (
            <BorderedCard key={s.id} className="flex flex-col gap-2 p-5">
              <p className="font-semibold text-ink">{s.mentorName} · {s.sessionType.replace(/_/g, " ")}</p>
              <p className="text-[13.5px] text-ink-soft">
                {new Date(s.scheduledStart).toLocaleString()} · {STATUS_LABEL[s.status] ?? s.status}
              </p>
              {s.status === "completed" && <ReviewForm sessionId={s.id} mentorId={s.mentorId} />}
            </BorderedCard>
          ))
        )}
      </section>
    </Container>
  );
}
