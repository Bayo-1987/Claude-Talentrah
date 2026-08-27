import { requireUser } from "@/lib/auth/require-user";
import { EyebrowLabel, BorderedCard } from "@/components/ui";
import { FeedbackForm } from "./feedback-form";
import { feedbackSchema } from "@/lib/feedback/schemas";

export const metadata = { title: "Feedback — Talentrah" };

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  // Authenticated-only: the row is keyed to a user id and the INSERT policy
  // checks it against the session. There is no signed-out path to build.
  await requireUser();

  /*
   * `?from=` is a URL the visitor controls, so it is validated here with the
   * same rule the action applies — a leading slash, and not the
   * protocol-relative "//host" form. Reusing `feedbackSchema` rather than a second check means the two
   * cannot drift; `.catch(null)` in the schema turns a bad value into no
   * value, so a mangled link costs a field and never the feedback itself.
   */
  const { from } = await searchParams;
  const parsed = feedbackSchema.shape.pagePath.safeParse(from ?? null);
  const pagePath = parsed.success ? parsed.data : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Feedback</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Tell us what&apos;s not working.</h1>
        <p className="max-w-[560px] text-[15px] text-ink-soft">
          Bugs, rough edges, or something you wish Talentrah did. This goes
          straight to the people building it.
        </p>
      </div>

      <BorderedCard className="max-w-[620px] p-6">
        <FeedbackForm pagePath={pagePath} />
      </BorderedCard>

      {/*
        Said plainly rather than implied by an empty page: nothing here shows
        past submissions, because nothing can. The table is write-only by
        design (0054) — a user cannot read even their own rows — so a history
        list is not a missing feature, it is a thing that would require
        undoing the lockdown.
      */}
      <p className="max-w-[560px] font-display text-[14px] italic text-ink-soft">
        We can&apos;t show you a history of what you&apos;ve sent — feedback is
        stored write-only, so nobody signed in can read it back.
      </p>
    </div>
  );
}
