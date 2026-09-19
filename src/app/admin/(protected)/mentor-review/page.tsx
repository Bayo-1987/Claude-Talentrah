import { requirePermission } from "@/lib/admin/require-admin";
import { pendingMentorApplications, approvedMentors } from "@/lib/admin/moderation/queues";
import { decideMentorApplicationAction, decideMentorStatusAction } from "@/lib/admin/moderation/actions";
import { DecisionForm } from "@/components/admin/decision-form";
import { QueueEmpty, QueueHeader } from "@/components/admin/queue-chrome";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";

export const metadata = {
  title: "Mentor applications — Talentrah admin",
  robots: { index: false, follow: false },
};

/**
 * Mentor onboarding & vetting (send-137, build-prompt §6.11 v1 slice):
 * applications awaiting an admin decision, reusing the existing admin
 * permission system (0075) via the new `mentor_review` permission (0132)
 * rather than a parallel admin surface.
 *
 * OLDEST FIRST, same fairness reasoning as the job-review queue: an
 * applicant who applied first should not wait behind one an admin happened
 * to look at sooner.
 *
 * APPROVING IS THE WHOLE GRANT. mentor_profiles' own SELECT policy reads
 * `status = 'approved'` directly — there is no second "go live" step, so
 * this button is the exact moment a mentor becomes publicly discoverable.
 */
export default async function MentorReviewQueuePage() {
  const admin = await requirePermission("mentor_review");
  const [queue, approved] = await Promise.all([pendingMentorApplications(), approvedMentors()]);

  return (
    <Container className="flex max-w-[900px] flex-col gap-8 py-12">
      <QueueHeader
        eyebrow="Mentor applications"
        title="Applications awaiting mentor approval."
        blurb="Oldest first. Approving makes this person publicly discoverable in Mentorship immediately — nothing else gates it."
        adminLabel={admin.displayName || admin.email}
      />

      {queue.length === 0 ? (
        <QueueEmpty>No mentor applications are waiting.</QueueEmpty>
      ) : (
        <ul data-testid="mentor-review-queue" className="flex list-none flex-col gap-5 p-0">
          {queue.map((application) => (
            <li key={application.userId}>
              <BorderedCard className="flex flex-col gap-4 p-5">
                <div className="flex flex-col gap-1.5">
                  <EyebrowLabel>{application.email}</EyebrowLabel>
                  <h2 className="font-display text-[20px] font-semibold leading-snug">
                    {application.name}
                  </h2>
                  <p className="text-[13.5px] text-ink-soft">
                    {application.yearsExperience != null
                      ? `${application.yearsExperience} years experience`
                      : "Years of experience not given"}
                    {" · "}
                    {application.basePriceNgn != null
                      ? `₦${application.basePriceNgn.toLocaleString()} / session`
                      : "Free / volunteer"}
                    {" · applied "}
                    {new Date(application.appliedAt).toLocaleDateString()}
                  </p>
                  {(application.expertiseRoles.length > 0 || application.expertiseIndustries.length > 0) && (
                    <p className="text-[13.5px] text-ink-soft">
                      {[...application.expertiseRoles, ...application.expertiseIndustries].join(" · ")}
                    </p>
                  )}
                  {/*
                    send-369 — a bio can now contain bold/italic markdown
                    syntax. Rendered here, not stripped: unlike the directory
                    list's clamped one-line excerpt, this is a full review
                    page where a moderator judging an application's
                    professionalism should see the formatting the applicant
                    actually intended, not raw markdown characters — the
                    same "full render" register mentorId/page.tsx uses, not
                    the "short preview" register the list card uses.
                  */}
                  {application.bio && renderJobDescriptionMarkdown(application.bio)}
                </div>

                <DecisionForm
                  id={application.userId}
                  action={decideMentorApplicationAction}
                  decisionName="decision"
                  noteName="note"
                  notePlaceholder="Note (required to reject, kept in the audit log)"
                  options={[
                    { value: "approved", label: "Approve as mentor", variant: "primary" },
                    { value: "rejected", label: "Reject", requiresNote: true },
                  ]}
                />
              </BorderedCard>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-4">
        <QueueHeader
          eyebrow="Approved mentors"
          title="Suspend or reinstate a listed mentor."
          blurb="Suspending removes them from Mentorship immediately and requires a reason. Reinstating restores their listing."
          adminLabel={admin.displayName || admin.email}
        />

        {approved.length === 0 ? (
          <QueueEmpty>No approved or suspended mentors yet.</QueueEmpty>
        ) : (
          <ul data-testid="approved-mentors-queue" className="flex list-none flex-col gap-5 p-0">
            {approved.map((mentor) => (
              <li key={mentor.userId}>
                <BorderedCard className="flex flex-col gap-4 p-5">
                  <div className="flex flex-col gap-1.5">
                    <EyebrowLabel>{mentor.email}</EyebrowLabel>
                    <h2 className="font-display text-[20px] font-semibold leading-snug">{mentor.name}</h2>
                    <p className="text-[13.5px] text-ink-soft">
                      {mentor.status === "approved" ? "Currently listed" : "Currently suspended"}
                    </p>
                    {mentor.status === "suspended" && mentor.reviewNote && (
                      <p className="text-[13px] text-ink-soft">Suspension note: {mentor.reviewNote}</p>
                    )}
                  </div>

                  <DecisionForm
                    id={mentor.userId}
                    action={decideMentorStatusAction}
                    decisionName="decision"
                    noteName="note"
                    notePlaceholder="Note (required to suspend, kept in the audit log)"
                    options={
                      mentor.status === "approved"
                        ? [{ value: "suspend", label: "Suspend", requiresNote: true }]
                        : [{ value: "reinstate", label: "Reinstate", variant: "primary" }]
                    }
                  />
                </BorderedCard>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}
