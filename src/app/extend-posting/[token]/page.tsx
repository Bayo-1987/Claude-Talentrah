import type { Metadata } from "next";
import Link from "next/link";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";
import { pageMetadata } from "@/lib/seo/site";
import { peekExtendToken } from "@/lib/jobs/expiry-reminders/extend";
import { ExtendForm } from "./extend-form";
import { refusalCopy } from "./copy";

/**
 * Extend a posting's closing date, reached from the link in the closing reminder (EMP-1 / E3, migration 0207).
 *
 * ── IT DOES NOT ACT ON GET, AND THAT IS THE POINT ─────────────────────────
 *
 * The unsubscribe page acts on GET and says why that is the right trade there (mail clients do not reliably POST, and
 * the state change is self-correcting). This is the opposite case. Mail clients, security gateways and link previewers
 * all FETCH links without a person ever clicking one, and extending a posting is not self-correcting: each scan would
 * quietly push a closing date out. So this page only READS (peekExtendToken changes nothing) and shows a confirm
 * button; the button is a form POST to a Server Action, the only thing that redeems the link.
 *
 * ── NO SESSION, BY NECESSITY, AND THAT IS A DECISION ──────────────────────
 *
 * The link works without signing in. The token in the URL is the authorisation: 256 random bits, single use, and valid
 * only until the closing date it was issued for. The person is in their mail client, quite possibly not signed in to
 * the browser it opens in, and what the link can do is one thing: move one closing date forward by 30 days, once. Anyone
 * who was forwarded the email can do that; they cannot read anything, close or edit the posting, or extend it twice.
 * The page is outside /employer on purpose, so it does not demand a sign-in the person may not have.
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
            <ExtendForm token={token} title={peek.title} closesAt={peek.closesAt} newClosesAt={peek.newClosesAt} />
          ) : (
            <Refusal copy={refusalCopy({ outcome: peek.state, closesAt: peek.state === "used" ? peek.closesAt : undefined })} />
          )}
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}

function Refusal({ copy }: { copy: { heading: string; body: string } }) {
  return (
    <>
      <h1 className="text-[32px] leading-[1.25]">{copy.heading}</h1>
      <p className="text-[15.5px] text-ink-soft">{copy.body}</p>
      <Link href="/employer/jobs" className="font-body text-[15px] font-semibold text-rust">
        Go to Jobs Posted
      </Link>
    </>
  );
}
