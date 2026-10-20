/**
 * DATA-EXPORT-CONFIRM-FEEDBACK-1. After the first press of Download my data the confirm page shows a line under the form: "Download started." and "Check your Downloads folder." (wording approved by
 * the owner, 20 Oct 2026). Hidden until that press; role="status" and aria-live="polite"; revealed by the page's own inline script, which stays the page's ONLY script; hidden again when the browser
 * restores the page from its back/forward cache. With scripts off the form still works as a plain POST form. Single use is NOT the script's job: it is the server's single claim (tests/data-export/confirm-single-use.test.ts).
 *
 * The page's own script is run here against a tiny fake document (the pattern of tests/legal/cookie-consent-banner.test.tsx), so the behaviour is tested, not just the markup. No database needed.
 * What does NOT change is held too: the pinned paragraph and button, one props argument, one script tag with no src, no emoji, the refusal page.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderConfirmPage, renderRefusalPage } from "@/lib/data-export/pages";

const id = randomUUID();
const html = renderConfirmPage({ id, expiresText: "2026-10-22 09:30 UTC" });
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

type Listener = (e: { persisted?: boolean; preventDefault: () => void }) => void;

/** A form, a button and an optional note, with just the calls the page's script makes. */
function dom({ withNote = true } = {}) {
  const attrs = new Map<string, string>();
  const formL: Record<string, Listener[]> = {};
  const winL: Record<string, Listener[]> = {};
  const button = { disabled: false };
  const note = { hidden: true };
  const form = {
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    addEventListener: (t: string, fn: Listener) => void (formL[t] ??= []).push(fn),
    querySelector: (sel: string) => (sel === "button" ? button : null),
  };
  const document = { getElementById: (i: string) => (i === "dl" ? form : i === "dl-note" && withNote ? note : null) };
  const window = { addEventListener: (t: string, fn: Listener) => void (winL[t] ??= []).push(fn) };
  new Function("document", "window", script)(document, window);
  const fire = (l: Record<string, Listener[]>, type: string, persisted?: boolean) => {
    const prevented: boolean[] = [];
    for (const fn of l[type] ?? []) fn({ persisted, preventDefault: () => void prevented.push(true) });
    return prevented.length > 0;
  };
  return {
    button,
    note,
    attrs,
    submit: () => fire(formL, "submit"),
    pageshow: (persisted: boolean) => fire(winL, "pageshow", persisted),
  };
}

describe("the markup", () => {
  it("has ONE status line under the form: hidden, role=status, aria-live=polite, the approved words", () => {
    const tags = html.match(/<p id="dl-note"[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatch(/\bhidden\b/);
    expect(tags[0]).toContain('role="status"');
    expect(tags[0]).toContain('aria-live="polite"');
    const inner = new RegExp('<p id="dl-note"[^>]*>([\\s\\S]*?)</p>').exec(html)![1].replace(/<[^>]+>/g, "");
    expect(inner).toBe("Download started. Check your Downloads folder.");
    expect(html.indexOf('id="dl-note"')).toBeGreaterThan(html.indexOf("</form>"));
    expect(html.indexOf('id="dl-note"')).toBeLessThan(html.indexOf("If you did not ask for this"));
  });

  it("has a [hidden] guard in the page's CSS, so a class cannot show the line before the press", () => {
    expect(html).toMatch(/\[hidden\]\{display:none/);
  });

  it("the refusal page has neither the line nor a script", () => {
    const refusal = renderRefusalPage();
    expect(refusal).not.toContain("dl-note");
    expect(refusal).not.toMatch(/<script/i);
  });
});

describe("what does not change", () => {
  it("the pinned paragraph, the button and the form are as before", () => {
    expect(html).toContain("This file holds the data we keep for your account. You can download it once. After you download it, we delete it from our servers. This link stops working on 2026-10-22 09:30 UTC either way.");
    expect(html).toContain("Download my data</button>");
    expect(html).toContain(`<form id="dl" method="post" action="/data-export/${id}">`);
    expect(html).toContain('<button type="submit" class="btn">');
  });

  it("still exactly one script tag, with no src, no emoji, and one props argument", () => {
    expect(html.match(/<script\b[^>]*>/g)).toEqual(["<script>"]);
    expect(html).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(/\p{Extended_Pictographic}/u.test(html)).toBe(false);
    expect(renderConfirmPage.length).toBe(1);
  });

  it("the form is a plain POST form that works without the script, and the line stays hidden until the script reveals it", () => {
    const form = /<form id="dl"[^>]*>([\s\S]*?)<\/form>/.exec(html)![0];
    expect(form).toContain('method="post"');
    expect(form).toContain('type="submit"');
    expect(html).toMatch(/<p id="dl-note"[^>]*\bhidden\b/);
  });
});

describe("what the page does not load or wire up", () => {
  it("has no inline event handler attribute anywhere (the only behaviour is the one script, listeners added from it)", () => {
    expect(html).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  });

  it("loads nothing from outside: no link, image, frame, embed, stylesheet import, url() or absolute address", () => {
    expect(html).not.toMatch(/<(link|img|iframe|embed|object|video|audio|source|base)\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/\s(src|srcset)\s*=/i);
  });

  it("exactly one script tag, and it is the inline one", () => {
    expect(html.match(/<script\b/gi)).toHaveLength(1);
  });
});

describe("the page's own script", () => {
  it("starts with the line hidden and the button enabled", () => {
    const d = dom();
    expect(d.note.hidden).toBe(true);
    expect(d.button.disabled).toBe(false);
  });

  it("the first submit shows the line, disables the button, and does not stop the form", () => {
    const d = dom();
    expect(d.submit()).toBe(false);
    expect(d.note.hidden).toBe(false);
    expect(d.button.disabled).toBe(true);
    expect(d.attrs.get("data-sent")).toBe("1");
  });

  it("a second submit is stopped and the line stays", () => {
    const d = dom();
    d.submit();
    expect(d.submit()).toBe(true);
    expect(d.note.hidden).toBe(false);
  });

  it("a page restored from the back/forward cache hides the line and re-enables the button; an ordinary pageshow changes nothing", () => {
    const d = dom();
    d.submit();
    d.pageshow(false);
    expect(d.note.hidden).toBe(false);
    expect(d.button.disabled).toBe(true);
    d.pageshow(true);
    expect(d.note.hidden).toBe(true);
    expect(d.button.disabled).toBe(false);
    expect(d.attrs.has("data-sent")).toBe(false);
    d.submit();
    expect(d.note.hidden).toBe(false);
  });

  it("does not throw if the line is missing from the page", () => {
    const d = dom({ withNote: false });
    expect(() => d.submit()).not.toThrow();
    expect(d.button.disabled).toBe(true);
  });
});
