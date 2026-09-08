/**
 * Deep-link an email address to its webmail provider, when one is known.
 *
 * A DOMAIN MATCH ONLY — nothing here parses the address for correctness. That
 * job belongs to `z.email(...)` in schemas.ts; this function's only concern is
 * "if this address ends in a domain we recognize, where does its inbox live".
 *
 * `null` IS LOAD-BEARING, not a placeholder. It covers a custom domain (an
 * employer's own `you@company.com`, or `talentrah.com` itself), an unknown
 * consumer provider, or a malformed string with no `@` at all. Every one of
 * those cases means "we cannot know the right URL", and the caller's job is
 * to hide the webmail button rather than guess — a wrong guess (linking to
 * Gmail for a Yahoo address, or to nothing useful for a company domain) is a
 * broken promise on a page that exists specifically to help someone who is
 * already stuck.
 */

const PROVIDER_URL_BY_DOMAIN: Record<string, string> = {
  "gmail.com": "https://mail.google.com/mail/u/0/",
  "googlemail.com": "https://mail.google.com/mail/u/0/",
  "outlook.com": "https://outlook.live.com/mail/",
  "hotmail.com": "https://outlook.live.com/mail/",
  "live.com": "https://outlook.live.com/mail/",
  "yahoo.com": "https://mail.yahoo.com/",
  "icloud.com": "https://www.icloud.com/mail/",
  "me.com": "https://www.icloud.com/mail/",
};

export function webmailUrlFor(email: string): string | null {
  const at = email.lastIndexOf("@");
  // No "@", or nothing after it (e.g. "foo@") — not a domain to match against.
  if (at === -1 || at === email.length - 1) return null;

  const domain = email.slice(at + 1).trim().toLowerCase();
  return PROVIDER_URL_BY_DOMAIN[domain] ?? null;
}
