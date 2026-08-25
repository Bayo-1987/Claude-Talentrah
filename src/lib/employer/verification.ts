/**
 * Employer verification — work-email-domain matching, and nothing more.
 *
 * WHAT THIS IS, precisely: CLAUDE.md's assumptions table records "Employer
 * verification = work-email domain only" as an ASSUMPTION standing in for an
 * open founder decision, not a decision that was made. This module implements
 * exactly that assumption and no more — it does not quietly grow into domain
 * ownership proof (DNS TXT, a verification email to postmaster@), and it is
 * not left as a stub that verifies everyone. Both of those would be inventing
 * an answer to a question that is still open.
 *
 * What it actually proves: the person creating the organisation can receive
 * mail at the domain they claim, because they signed up with an address there
 * and confirmed it. That is a real signal and a weak one. It does not prove
 * they are authorised to act for the company — any employee, or anyone who can
 * get an address at that domain, clears it.
 *
 * What it deliberately does NOT do is let anyone verify themselves with a
 * consumer mailbox. Without the free-provider check the rule would be "type
 * gmail.com into the domain field", which is not a check at all.
 *
 * The gate this feeds is real: an unverified organisation's job postings never
 * reach the public feed (migration 0027), and an organisation cannot mark
 * itself verified (migration 0028) — verification only ever happens here, on
 * the server, through the service role.
 */
import "server-only";

/**
 * Consumer mailbox providers. Deliberately short and boring: it covers the
 * addresses this market actually signs up with, and the cost of a miss is one
 * organisation staying unverified until someone reviews it — not a breach.
 * A miss in the other direction (treating a consumer domain as a company) is
 * the one that matters, so err toward listing.
 */
const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  // Nigeria/Africa-facing consumer and ISP mail seen in this market.
  "rocketmail.com",
  "mail.ru",
]);

/** Everything after the last "@", lowercased and trimmed. Null if unusable. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase() || null;
}

/**
 * Normalises what a person types into the domain field. People paste URLs and
 * full email addresses in here — accepting only a bare hostname would fail
 * them for a formatting reason and, worse, would silently leave the
 * organisation unverified rather than telling them why.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;

  if (value.includes("@")) value = value.slice(value.lastIndexOf("@") + 1);
  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0];
  value = value.split("?")[0];
  value = value.replace(/\.$/, "");

  // A domain needs at least one dot and no whitespace or @ left over.
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value)) return null;
  return value;
}

export function isConsumerEmailDomain(domain: string | null): boolean {
  return !!domain && CONSUMER_EMAIL_DOMAINS.has(domain);
}

export type VerificationOutcome = {
  verified: boolean;
  /** Domain to store on the organisation, normalised. Null if unusable. */
  domain: string | null;
  /**
   * Why it came out that way, in words a person can act on. Shown in the UI —
   * an employer who is not verified needs to know what would change that, and
   * silence here is what makes a gate feel arbitrary.
   */
  reason:
    | "verified_domain_match"
    | "no_domain_given"
    | "consumer_email_domain"
    | "domain_mismatch"
    | "email_unconfirmed";
};

/**
 * The whole rule, in one pure function so it can be tested without a database.
 *
 * Requires a CONFIRMED email: an unconfirmed address proves nothing about who
 * can receive mail at that domain, and treating it as proof would reduce
 * verification to "type a company domain into the signup form".
 */
export function evaluateDomainVerification(args: {
  userEmail: string | null | undefined;
  emailConfirmed: boolean;
  claimedDomain: string | null | undefined;
}): VerificationOutcome {
  const domain = normalizeDomain(args.claimedDomain);
  if (!domain) return { verified: false, domain: null, reason: "no_domain_given" };
  if (isConsumerEmailDomain(domain)) {
    return { verified: false, domain, reason: "consumer_email_domain" };
  }
  if (!args.emailConfirmed) {
    return { verified: false, domain, reason: "email_unconfirmed" };
  }

  const userDomain = emailDomain(args.userEmail);
  if (!userDomain || userDomain !== domain) {
    return { verified: false, domain, reason: "domain_mismatch" };
  }
  return { verified: true, domain, reason: "verified_domain_match" };
}

/** Human-readable explanation, for the employer looking at their own org. */
export function verificationMessage(outcome: VerificationOutcome, userEmail?: string | null): string {
  switch (outcome.reason) {
    case "verified_domain_match":
      return "Verified — your work email matches this domain.";
    case "no_domain_given":
      return "Add your company's website domain to get verified. Until then your jobs stay private to your team.";
    case "consumer_email_domain":
      return `${outcome.domain} is a personal email provider, not a company domain. Add your company's own domain to get verified.`;
    case "email_unconfirmed":
      return "Confirm your email address first — verification matches it against your company domain.";
    case "domain_mismatch":
      return `Your account email${userEmail ? ` (${userEmail})` : ""} isn't at ${outcome.domain}. Sign up with your work email at that domain to get verified.`;
  }
}
