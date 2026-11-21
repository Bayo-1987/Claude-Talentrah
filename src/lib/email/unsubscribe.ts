import { absoluteUrl } from "@/lib/seo/site";
import type { UnsubscribablePreference } from "@/app/unsubscribe/preference";

/**
 * The one-click unsubscribe header pair (RFC 8058), built in ONE place for every email that carries an unsubscribe link: the weekly digest, the proactive match alert, the scholarship deadline alert, the
 * win-back email, and the admin announcements and promotions. A mail client that sees both headers shows its own "Unsubscribe" button and POSTs to the URL, with no page and no click on a link.
 *
 * The URL is POST /api/unsubscribe, the endpoint that accepts that POST; a GET there changes nothing (so a link scanner that fetches it does nothing). It is NOT the address of the link in the email
 * body: that stays `/unsubscribe?token=..&pref=..`, the confirm page a person lands on when they click. `pref` is always spelled out, including for the digest, so the kind never depends on a default.
 *
 * The header names appear in no other source file (tests/email/unsubscribe-headers.test.ts scans for it): a hand-built header is how the two addresses drift apart.
 */
export function oneClickUnsubscribeUrl(token: string, preference: UnsubscribablePreference): string {
  return absoluteUrl(`/api/unsubscribe?token=${encodeURIComponent(token)}&pref=${preference}`);
}

export function unsubscribeHeaders(token: string, preference: UnsubscribablePreference): { "List-Unsubscribe": string; "List-Unsubscribe-Post": string } {
  if (!token) throw new Error("an unsubscribe header needs the recipient's token");
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token, preference)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
