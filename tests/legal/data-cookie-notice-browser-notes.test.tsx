/**
 * The Data & Cookie Notice must tell a person about the two small notes the app saves in their own browser: the one that remembers Farah has been opened once (the launcher's first-visit
 * pill, src/lib/farah/launcher-seen.ts) and the one that remembers their cookie-banner choice (src/components/legal/cookie-consent-script.ts). The page names each by its storage key, taken
 * from the code that owns it, so renaming a key without updating the notice fails here.
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

  it("says in plain words that they are saved in the browser, on the device only, and why", () => {
    const t = text();
    expect(t).toContain("saved in your browser");
    expect(t).toMatch(/on your device only|only on your device/);
    expect(t).toMatch(/opened Farah/);
    expect(t).toMatch(/cookie banner/);
  });

  it("is one sentence under its own heading", () => {
    const html = renderToStaticMarkup(<DataCookieNoticePage />);
    const section = /<h2[^>]*>Notes saved in your browser<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(html);
    expect(section, "the heading and its paragraph").not.toBeNull();
    const sentence = section![1].replace(/<[^>]+>/g, "").trim();
    expect(sentence.match(/[.!?](\s|$)/g)).toHaveLength(1);
  });
});
