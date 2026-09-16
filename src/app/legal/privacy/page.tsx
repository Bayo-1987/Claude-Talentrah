import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy — Talentrah",
  description: "How Talentrah collects, uses, and protects your data.",
  path: "/legal/privacy",
});

/**
 * DRAFT — grounded in the app&apos;s actual data flows (Supabase auth/storage,
 * Groq as the primary AI processor for resume/JD/Farah content with Gemini
 * as an automatic rate-limit failover — see CLAUDE.md&apos;s LLM-provider
 * notes and generateWithFailover in src/lib/llm/index.ts — Paystack for
 * payments, Google/LinkedIn OAuth) but has not had a legal review pass. Do
 * not treat as final/binding until reviewed against the Nigeria Data
 * Protection Act (and any other jurisdiction Talentrah actually operates
 * in) by counsel. The registered legal entity name and address below are
 * now filled in with founder-supplied real values — that is not the same
 * thing as a legal review having happened, and this page still has not had
 * one; do not treat it as final/binding until it does.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy Policy" lastUpdated="September 16, 2026">
      <p>
        This Privacy Policy explains what personal data Talentrah (&quot;Talentrah,&quot;
        &quot;we,&quot; &quot;us&quot;) collects when you use our website and app, why we collect
        it, and the choices you have. Talentrah is operated by Talentrah
        Technologies Ltd, JF4, Sky Memorial Complex, Zone 5, Wuse, Abuja,
        Nigeria.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — name, email, country, and
          password (or, if you sign in with Google or LinkedIn, the basic
          profile information those providers share with us — see
          &quot;Signing in with Google&quot; below for exactly what that is).
        </li>
        <li>
          <strong>Resume and profile content</strong> — anything you upload or
          enter: your resume file, work history, skills, and job preferences.
        </li>
        <li>
          <strong>Job descriptions you submit</strong> — pasted or linked job
          postings you ask Farah to analyze or tailor a resume against.
        </li>
        <li>
          <strong>Usage and application data</strong> — jobs you view, save,
          or apply to; messages you exchange with Farah; credit and billing
          history.
        </li>
        <li>
          <strong>Payment information</strong> — handled directly by our
          payment processor, Paystack; we receive confirmation of a
          successful payment, not your card details.
        </li>
      </ul>

      <h2>Signing in with Google</h2>
      <p>
        If you choose to sign in with Google, Talentrah requests only your
        basic Google account information — your name, email address, and
        profile picture. We use this solely to create and authenticate your
        Talentrah account. We do not request, and do not use, access to any
        other Google service or data (for example, Gmail, Drive, Calendar,
        or Contacts). Once received, this information is stored and
        protected the same way as the rest of your account data — see
        &quot;Data retention&quot; and &quot;Who we share data with&quot;
        below.
      </p>

      <h2>How we use it</h2>
      <p>
        We use your information to operate the core product: matching you to
        relevant roles, generating tailored resumes and gap analysis through
        our AI assistant Farah, processing payments for credits and passes,
        and communicating with you about your account. We do not sell your
        personal data.
      </p>
      <p>
        We also send a weekly email highlighting new roles that match your
        resume. Those are picked automatically from your resume and the jobs
        you&apos;ve saved or applied to, and every one carries a one-click
        unsubscribe. Opting out stops that email only — you&apos;ll still get
        messages about your account, like password resets and payment
        receipts.
      </p>

      <h2>AI processing</h2>
      <p>
        Resume content, job descriptions, and your conversations with Farah
        are sent to Groq, our primary AI processor, to generate matches,
        tailored resumes, and gap analysis. If Groq is temporarily at
        capacity, that same request is automatically sent instead to
        Google&apos;s Gemini API, as a backup, so the feature keeps working.
        Both Groq and Google process this data as our service providers,
        under their own data processing terms, and neither uses it to train
        their general-purpose AI models.
      </p>

      <h2>Who we share data with</h2>
      <ul>
        <li>Employers or recruiters, only for roles you actively apply to.</li>
        <li>
          Service providers who help us run Talentrah: Supabase (database and
          authentication), Groq and Google (AI processing — see &quot;AI
          processing&quot; above), Paystack (payment processing), and Resend
          (sending email).
        </li>
        <li>Law enforcement or regulators, only where we&apos;re legally required to.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you&apos;re located, you may have the right to access,
        correct, export, or delete your personal data, and to object to or
        restrict certain processing. Contact us at{" "}
        <a href="/contact">our contact page</a> to exercise any of these
        rights.
      </p>

      <h2>Data retention</h2>
      <p>
        We keep your account and resume data for as long as your account is
        active. If you delete your account, we delete or anonymize your
        personal data within a reasonable period, except where we&apos;re required
        to keep records (for example, payment records for tax purposes).
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data can be sent to{" "}
        <a href="/contact">our contact page</a>.
      </p>
    </LegalPage>
  );
}
