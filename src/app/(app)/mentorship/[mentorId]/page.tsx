import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getMentorProfile } from "@/lib/mentorship/queries";
import { bookMentorSessionAction } from "@/lib/mentorship/actions";
import { computeSessionPrice, type MentorshipSessionType } from "@/lib/mentorship/pricing";
import { Container, EyebrowLabel, Card, Button } from "@/components/ui";

export const metadata = { title: "Book a mentor — Talentrah" };

const SESSION_TYPES: { value: MentorshipSessionType; label: string }[] = [
  { value: "resume_review", label: "Resume review" },
  { value: "mock_interview", label: "Mock interview" },
  { value: "career_strategy", label: "Career strategy" },
  { value: "negotiation_strategy", label: "Negotiation strategy for a specific offer" },
  { value: "quick_question", label: "Quick question (15 min)" },
];

/**
 * A MENTOR CANNOT BOOK THEIR OWN LISTING AS A MENTEE. Not enforced here — this
 * page shows the booking form to anyone, including the mentor themselves —
 * because `mentorship_sessions.mentee_id`/`mentor_id` are both plain FKs with
 * no CHECK forbidding them being equal, so the real guard has to be an
 * explicit check inside `book_mentor_session` (0133) itself, not an
 * assumption from the schema shape or a UI-layer filter a determined client
 * could route around. See tests/mentorship/dual-role-isolation.test.ts,
 * which is what actually proves it.
 */
export default async function MentorProfilePage({
  params,
}: {
  params: Promise<{ mentorId: string }>;
}) {
  await requireUser();
  const { mentorId } = await params;
  const mentor = await getMentorProfile(mentorId);
  if (!mentor) notFound();

  async function book(formData: FormData) {
    "use server";
    const slotId = String(formData.get("slotId") ?? "");
    const sessionType = String(formData.get("sessionType") ?? "") as MentorshipSessionType;
    if (!slotId || !sessionType) redirect(`/mentorship/${mentorId}?error=${encodeURIComponent("Pick a slot and a session type.")}`);
    await bookMentorSessionAction(slotId, sessionType);
  }

  return (
    <Container className="flex max-w-[720px] flex-col gap-8 py-12">
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Mentorship</EyebrowLabel>
        <h1 className="font-display text-[28px] font-semibold">{mentor.name}</h1>
        {mentor.bio && <p className="text-[14.5px] text-ink-soft">{mentor.bio}</p>}
        {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].length > 0 && (
          <p className="text-[13px] font-semibold text-ink">
            {[...mentor.expertiseRoles, ...mentor.expertiseIndustries].join(" · ")}
          </p>
        )}
      </div>

      {mentor.openSlots.length === 0 ? (
        <p className="text-[14px] text-ink-soft">No open slots right now — check back later.</p>
      ) : (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="font-display text-[18px] font-semibold">Book a session</h2>
          <form action={book} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="slotId" className="font-body text-[13px] font-semibold text-ink-soft">
                Time
              </label>
              <select
                id="slotId"
                name="slotId"
                required
                className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink"
              >
                {mentor.openSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {new Date(slot.startAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="sessionType" className="font-body text-[13px] font-semibold text-ink-soft">
                What do you need?
              </label>
              <select
                id="sessionType"
                name="sessionType"
                required
                className="min-h-11 border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[15px] text-ink"
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                    {mentor.basePriceNgn != null
                      ? ` — ₦${computeSessionPrice(mentor.basePriceNgn, t.value).toLocaleString()}`
                      : " — free"}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-[12.5px] text-ink-soft">
              You&apos;ll get a meeting link once {mentor.name} confirms. If they
              don&apos;t confirm within 24 hours of the scheduled time, the
              booking is cancelled and any payment is refunded automatically.
            </p>

            <Button type="submit" variant="primary">
              {mentor.basePriceNgn != null ? "Continue to payment" : "Book this session"}
            </Button>
          </form>
        </Card>
      )}
    </Container>
  );
}
