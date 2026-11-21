import type { Metadata } from "next";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { pageMetadata } from "@/lib/seo/site";
import { ConfirmUnsubscribe } from "./confirm-unsubscribe";
import { NOT_WORKING_COPY } from "./copy";
import { parsePreference } from "./preference";

/**
 * Unsubscribe, reached from a link in the digest, send-138's proactive match alert, send-466's scholarship deadline alert, send-467's win-back email, or an admin announcement or promotion — `pref` in
 * the query string picks which (defaulting to the digest, so every digest email already sent before the others existed still points at valid behaviour with no `pref` at all).
 *
 * ── NO SESSION, BY NECESSITY ──────────────────────────────────────────────
 *
 * The person clicking is in their mail client, quite possibly on a different device from the one they signed in on, and quite possibly annoyed. Making them log in to stop email is the behaviour that
 * gets a sender marked as spam. The token in the link IS the authorisation, which is why it is 32 random bytes and why the table it lives in is unreachable from PostgREST — see 0083.
 *
 * ── A GET CHANGES NOTHING (UNSUB-GET-SCANNER-1) ───────────────────────────
 *
 * This page used to unsubscribe on GET. Mail clients and link scanners open every link in a message, so people were unsubscribed who never asked. A GET now only shows a confirm page; the change is a
 * POST, either this page's button (a server action) or the one-click endpoint POST /api/unsubscribe that a mail client's own "Unsubscribe" button calls. Old links keep landing here. This file therefore
 * holds no database call: tests/notifications/unsubscribe-confirm-and-post.test.tsx reads it and fails if one appears. The undo (resubscribe) is unchanged.
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

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; pref?: string }>;
}) {
  const { token, pref } = await searchParams;
  const preference = parsePreference(pref);

  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-24">
        <Container className="flex max-w-[620px] flex-col gap-5">
          <EyebrowLabel>Email preferences</EyebrowLabel>
          {token ? (
            <ConfirmUnsubscribe token={token} preference={preference} />
          ) : (
            <>
              <h1 className="text-[32px] leading-[1.25]">{NOT_WORKING_COPY.heading}</h1>
              <p className="text-[15.5px] text-ink-soft">{NOT_WORKING_COPY.body}</p>
            </>
          )}
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
