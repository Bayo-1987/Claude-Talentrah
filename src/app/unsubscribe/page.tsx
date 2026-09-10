import type { Metadata } from "next";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { pageMetadata } from "@/lib/seo/site";
import { ResubscribeButton } from "./resubscribe-button";
import { parsePreference } from "./preference";

/**
 * Unsubscribe, reached from a link in either the digest or send-138's
 * proactive match alert — `pref` in the query string picks which
 * (defaulting to the digest, so every digest email already sent before
 * send-138 existed still points at valid behaviour with no `pref` at all).
 *
 * ── NO SESSION, BY NECESSITY ──────────────────────────────────────────────
 *
 * The person clicking is in their mail client, quite possibly on a different
 * device from the one they signed in on, and quite possibly annoyed. Making
 * them log in to stop email is the behaviour that gets a sender marked as
 * spam. The token in the link IS the authorisation, which is why it is 32
 * random bytes and why the table it lives in is unreachable from PostgREST —
 * see 0083.
 *
 * ── IT ACTS ON GET, WHICH IS NORMALLY WRONG ───────────────────────────────
 *
 * A GET that changes state is bad practice, and here it is the correct trade:
 * mail clients and their link-scanners do not reliably POST, and an
 * unsubscribe that needs a second click to take effect is one that some people
 * will believe they completed and did not. The state change is
 * self-correcting — the same page offers a one-click resubscribe — so the cost
 * of a prefetcher firing it is a message saying so and a button to undo, which
 * is far cheaper than mail that will not stop.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Email preferences — Talentrah",
    description: "Manage the email Talentrah sends you.",
    path: "/unsubscribe",
  }),
  /*
   * Never indexed, and this is not cosmetic: the URL carries a bearer token.
   * A crawler that reaches one of these and publishes it hands anyone who
   * finds it the ability to change that person's email settings.
   */
  robots: { index: false, follow: false },
};

const COPY = {
  job_match_digest: {
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "We won't send you the weekly job-match email again. This doesn't affect your account, and it doesn't stop messages about things you asked for — password resets, payment receipts, and the like.",
    },
  },
  proactive_match_alert: {
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "Farah won't send the rare \"exceptional match\" alert to your inbox again. This doesn't affect your account, your weekly digest (if you're subscribed to it), or anything else Talentrah sends.",
    },
  },
} as const;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; pref?: string }>;
}) {
  const { token, pref } = await searchParams;
  const preference = parsePreference(pref);

  let matched = false;
  if (token) {
    const supabase = createServiceRoleClient();
    const { data, error } =
      preference === "proactive_match_alert"
        ? await supabase.rpc("proactive_match_alert_set_preference", { p_token: token, p_enabled: false })
        : await supabase.rpc("email_unsubscribe", { p_token: token, p_subscribed: false });
    if (error) {
      console.error("[unsubscribe] rpc failed:", error.message);
    } else {
      matched = data?.[0]?.matched === true;
    }
  }

  const copy = COPY[preference].unsubscribed;

  return (
    <>
      <MarketingMasthead />
      <div className="py-24">
        <Container className="flex max-w-[620px] flex-col gap-5">
          <EyebrowLabel>Email preferences</EyebrowLabel>
          {matched ? (
            <>
              <h1 className="text-[32px] leading-[1.25]">{copy.heading}</h1>
              <p className="text-[15.5px] text-ink-soft">{copy.body}</p>
              {/* Undo, because a mis-click or a link scanner should not cost
                  somebody a channel they wanted. */}
              <ResubscribeButton token={token!} preference={preference} />
            </>
          ) : (
            <>
              <h1 className="text-[32px] leading-[1.25]">That link didn&apos;t work.</h1>
              <p className="text-[15.5px] text-ink-soft">
                It may have already been used, or the address may have been changed since the email
                went out. Nothing has been altered. If you keep receiving email you don&apos;t want,
                reply to any of it and we&apos;ll sort it out by hand.
              </p>
            </>
          )}
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
