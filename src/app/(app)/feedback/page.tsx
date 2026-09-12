import { requireUser } from "@/lib/auth/require-user";
import { EyebrowLabel, Card } from "@/components/ui";
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

  /*
   * A direct WhatsApp line to Talentrah's own support number — distinct from
   * the marketing footer's WhatsApp COMMUNITY group link. Not a secret, so a
   * plain env var; rendered only when it's set, same "omit until the account
   * is real" convention as the footer's social links.
   *
   * The message carries `pagePath` when we have it, so a report that comes
   * in over WhatsApp instead of the form still says which page it's about —
   * the same context the form's own hidden `pagePath` field captures.
   * Built here, server-side, as a plain string — not constructed in a click
   * handler — so the link is a real `<a href>` that works with JS disabled.
   */
  const supportWhatsappNumber = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;
  const whatsappMessage = pagePath
    ? `Hi Talentrah — I have some feedback about ${pagePath}: `
    : "Hi Talentrah — I have some feedback: ";
  const whatsappHref = supportWhatsappNumber
    ? `https://wa.me/${supportWhatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <EyebrowLabel>Feedback</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Tell us what&apos;s not working.</h1>
        <p className="max-w-[560px] text-[15px] text-ink-soft">
          Bugs, rough edges, or something you wish Talentrah did. This goes
          straight to the people building it.
        </p>
        {whatsappHref && (
          <p className="max-w-[560px] text-[15px] text-ink-soft">
            Prefer WhatsApp?{" "}
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-coral underline underline-offset-2 hover:text-coral-hover"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M4 4h12v9H8l-4 3V4Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              Message us on WhatsApp
            </a>{" "}
            — often faster for a quick one.
          </p>
        )}
      </div>

      <Card className="max-w-[620px] p-6">
        <FeedbackForm pagePath={pagePath} />
      </Card>

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
