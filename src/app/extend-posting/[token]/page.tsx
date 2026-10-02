import type { Metadata } from "next";
import Link from "next/link";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { pageMetadata } from "@/lib/seo/site";
import { peekExtendToken } from "@/lib/jobs/expiry-reminders/extend";
import { ExtendForm } from "./extend-form";
import { REFUSALS } from "./copy";

/**
 * Extend a posting's closing date, reached from the link in the 3-day closing reminder (EMP-1 / E3, migration 0207).
 *
 * ── IT DOES NOT ACT ON GET, AND THAT IS THE POINT ─────────────────────────
 *
 * The unsubscribe page acts on GET and says why that is the right trade there (mail clients do not reliably POST, and
 * the state change is self-correcting). This is the opposite case. Mail clients, security gateways and link previewers
 * all FETCH links without a person ever clicking one, and extending a posting is not self-correcting: each scan would
 * quietly push a closing date out. So this page only READS (peekExtendToken changes nothing) and shows a confirm
 * button; the button is a form POST to a Server Action, the only thing that redeems the link.
 *
 * ── NO SESSION, BY NECESSITY ──────────────────────────────────────────────
 *
 * The token in the URL is the authorisation, 256 random bits, single use, valid only until the closing date it was
 * issued for. The page is outside /employer on purpose, so it does not demand a sign-in the person may not have in
 * the browser their mail opens in.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Extend your job posting — Talentrah",
    description: "Keep a job posting open for another 30 days.",
    path: "/extend-posting",
  }),
  // The URL carries a bearer token: never indexed.
  robots: { index: false, follow: false },
};

export default async function ExtendPostingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const peek = await peekExtendToken(token);

  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-24">
        <Container className="flex max-w-[620px] flex-col gap-5">
          <EyebrowLabel>Job posting</EyebrowLabel>
          {peek.state === "ready" ? (
            <ExtendForm token={token} title={peek.title} closesAt={peek.closesAt} />
          ) : (
            <>
              <h1 className="text-[32px] leading-[1.25]">{REFUSALS[peek.state].heading}</h1>
              <p className="text-[15.5px] text-ink-soft">{REFUSALS[peek.state].body}</p>
              <Link href="/employer/jobs" className="font-body text-[15px] font-semibold text-rust">
                Go to Jobs Posted
              </Link>
            </>
          )}
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
