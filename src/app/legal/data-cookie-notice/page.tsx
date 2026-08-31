import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Data & Cookie Notice — Talentrah",
  description: "How Talentrah uses cookies and processes your data technically.",
  path: "/legal/data-cookie-notice",
});

/**
 * DRAFT — see the note in src/app/legal/privacy/page.tsx. The cookie list
 * below reflects what the app actually sets today (Supabase SSR auth
 * cookies via @supabase/ssr) — update it if/when analytics or ad-tracking
 * cookies are added, rather than letting this drift from reality.
 */
export default function DataCookieNoticePage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Data & Cookie Notice"
      lastUpdated="[DATE — set at launch]"
    >
      <p>
        This notice explains, in plain terms, the technical side of how
        Talentrah handles data in your browser and where your information is
        processed. It complements our <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2>Cookies we use</h2>
      <ul>
        <li>
          <strong>Authentication cookies (required)</strong> — set by
          Supabase to keep you signed in and to verify each request comes
          from you. Talentrah doesn&apos;t function without these; they can&apos;t be
          turned off individually, only by not using the site.
        </li>
      </ul>
      <p>
        Talentrah does not currently set advertising or third-party tracking
        cookies. If that changes — for example, to add product analytics —
        this page will be updated first, and where required we&apos;ll ask for
        your consent before setting anything beyond what&apos;s required for the
        site to function.
      </p>

      <h2>Where your data is processed</h2>
      <ul>
        <li>
          <strong>Supabase</strong> — account records, resume/profile data,
          and application history.
        </li>
        <li>
          <strong>Google (Gemini API)</strong> — resume and job-description
          content you submit for matching, tailoring, and Farah&apos;s chat
          responses.
        </li>
        <li>
          <strong>Paystack</strong> — payment processing for credits and
          passes; Talentrah never stores your card details directly.
        </li>
      </ul>

      <h2>Managing cookies in your browser</h2>
      <p>
        Most browsers let you block or delete cookies through their settings.
        Blocking the authentication cookie will prevent you from staying
        signed in to Talentrah.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this notice can be sent to{" "}
        <a href="/contact">our contact page</a>.
      </p>
    </LegalPage>
  );
}
