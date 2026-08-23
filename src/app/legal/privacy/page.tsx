import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Talentrah",
  description: "How Talentrah collects, uses, and protects your data.",
};

/**
 * DRAFT — grounded in the app&apos;s actual data flows (Supabase auth/storage,
 * Gemini API for resume/JD processing, Paystack for payments, Google/
 * LinkedIn OAuth) but has not had a legal review pass. Do not treat as
 * final/binding until reviewed against the Nigeria Data Protection Act
 * (and any other jurisdiction Talentrah actually operates in) by counsel.
 * [Registered legal entity name / RC number / registered address] is a
 * placeholder pending that review — fill in before launch.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalPage eyebrow="Legal" title="Privacy Policy" lastUpdated="[DATE — set at launch]">
      <p>
        This Privacy Policy explains what personal data Talentrah (&quot;Talentrah,&quot;
        &quot;we,&quot; &quot;us&quot;) collects when you use our website and app, why we collect
        it, and the choices you have. Talentrah is operated by [Talentrah&apos;s
        registered legal entity name], [registered address].
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — name, email, country, and
          password (or, if you sign in with Google or LinkedIn, the basic
          profile information those providers share with us).
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

      <h2>How we use it</h2>
      <p>
        We use your information to operate the core product: matching you to
        relevant roles, generating tailored resumes and gap analysis through
        our AI assistant Farah, processing payments for credits and passes,
        and communicating with you about your account. We do not sell your
        personal data.
      </p>

      <h2>AI processing</h2>
      <p>
        Resume content, job descriptions, and your conversations with Farah
        are sent to Google&apos;s Gemini API to generate matches, tailored
        resumes, and gap analysis. Google processes this data as our service
        provider under its own data processing terms — it is not used to
        train Google&apos;s general-purpose models.
      </p>

      <h2>Who we share data with</h2>
      <ul>
        <li>Employers or recruiters, only for roles you actively apply to.</li>
        <li>
          Service providers who help us run Talentrah: Supabase (database and
          authentication), Google (AI processing via Gemini), and Paystack
          (payment processing).
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
