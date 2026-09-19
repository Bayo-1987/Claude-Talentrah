import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, buttonClasses } from "@/components/ui";

export const metadata: Metadata = pageMetadata({
  title: "Page not found — Talentrah",
  description: "This page doesn&apos;t exist.",
  path: "/404",
  robots: "noindex",
});

/**
 * Root-level App Router convention: renders for any unmatched route
 * site-wide, since no route group here defines its own not-found.tsx.
 */
export default function NotFound() {
  return (
    <>
      <MarketingMasthead />
      {/* send-381 (WCAG 1.3.1/2.4.1) — retagged from a plain <div>; id="main-content" is the skip link's target. */}
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-8">
          <EyebrowLabel>404</EyebrowLabel>
          <h1 className="text-[36px] leading-[1.2]">This page doesn&apos;t exist.</h1>
          <p className="text-[16px] text-ink-soft">
            The link you followed may be broken, or the page may have moved. You can
            head back home or keep browsing open roles.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className={buttonClasses("primary", "md", "no-underline")}>
              Go home
            </Link>
            <Link href="/jobs" className={buttonClasses("secondary", "md", "no-underline")}>
              Browse jobs
            </Link>
          </div>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
