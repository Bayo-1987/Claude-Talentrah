/**
 * The Data & Cookie Notice must tell a person about the small notes the app saves in their own browser. This file pins the wording for the Farah launcher's note (src/lib/farah/launcher-seen.ts),
 * the cookie-banner choice (src/components/legal/cookie-consent-script.ts) and the remembered sign-in email (src/lib/auth/remembered-email.ts), naming each by the key the owning code spells.
 * That EVERY storage key in src is named is a separate guard, tests/legal/client-storage-keys-in-notice.test.tsx. The intro carries no count ("two"), which can go stale.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DataCookieNoticePage from "@/app/legal/data-cookie-notice/page";
import { FARAH_LAUNCHER_KEY } from "@/lib/farah/launcher-seen";
import { COOKIE_CONSENT_STORAGE_KEY } from "@/components/legal/cookie-consent-script";

const text = () => renderToStaticMarkup(<DataCookieNoticePage />).replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("the Data & Cookie Notice and the notes saved in the browser", () => {
  it("names both storage keys, as the code spells them today", () => {
    expect(text()).toContain(FARAH_LAUNCHER_KEY);
    expect(text()).toContain(COOKIE_CONSENT_STORAGE_KEY);
  });

  it("says in plain words that the notes are in the browser, on the device only, and what each remembers", () => {
    const t = text();
    expect(t).toContain("saved in your browser");
    expect(t).toContain("on your device only");
    expect(t).toMatch(/opened Farah once/);
    expect(t).toMatch(/answer to the cookie banner/);
    expect(t).toMatch(/email address you last signed in with/);
  });

  it("says the remembered sign-in email stays on this device, and how to clear it", () => {
    const html = renderToStaticMarkup(<DataCookieNoticePage />);
    const item = /<li>\s*<strong>talentrah\.lastEmail<\/strong>([\s\S]*?)<\/li>/.exec(html);
    expect(item, "the remembered email has its own list item").not.toBeNull();
    const t = item![1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(t).toContain("It stays on this device");
    expect(t).toMatch(/Use another account/);
  });

  it("puts a number nowhere in the section's intro (a count would go stale), and lists each key in a bold name", () => {
    const html = renderToStaticMarkup(<DataCookieNoticePage />);
    const intro = /<h2[^>]*>Notes saved in your browser<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(html);
    expect(intro, "the heading and its intro paragraph").not.toBeNull();
    expect(intro![1].replace(/<[^>]+>/g, "")).not.toMatch(/\b(one|two|three|four|five|six|seven|\d+)\b\s+(small\s+)?(notes|keys|items)/i);
    for (const key of [FARAH_LAUNCHER_KEY, COOKIE_CONSENT_STORAGE_KEY]) expect(html).toContain(`<strong>${key}</strong>`);
  });
});
