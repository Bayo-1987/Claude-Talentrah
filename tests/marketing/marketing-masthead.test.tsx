/**
 * send-488 — the signed-out masthead's markup: the parts a phone-width fix could break and the parts it
 * must NOT change.
 *
 * The layout itself (wrapping, spill out of the bar, 44px targets, overflow) can only be measured in a
 * browser: e2e/masthead-signed-out-mobile.spec.ts does that. This file pins what a server render can see:
 *
 *  - the CTA keeps the accessible name "Get started for free" while its VISIBLE label is shortened below
 *    640px. That is `aria-label` on the link, with the long and short labels as two spans toggled by
 *    breakpoint (the short one aria-hidden, so a screen reader never hears both). WCAG "label in name":
 *    the visible words "Get started" are the start of the accessible name.
 *  - the logo link has a 44px-tall hit area (`min-h-11`, no visual change: the image keeps its size).
 *  - the four nav links, in order, with their anchors.
 *  - DESKTOP CLASSES ARE UNTOUCHED: every class the masthead had before this change is still present, so
 *    from 640px up nothing is restyled (proven by byte-identical screenshots at 1280/1000/900/899/700/640).
 *    This includes the CTA's `px-[22px] py-[11px] text-[14px]`, which is dead on desktop today (the base
 *    variant classes win in cn()'s plain join) and is deliberately left alone here: fixing it would change
 *    the desktop CTA, and is its own task.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";

const html = renderToStaticMarkup(<MarketingMasthead />);

/**
 * The attributes and inner markup of the first anchor with this exact href. Attribute-order agnostic:
 * next/link emits `class` before `href`, a plain <a> emits `href` first.
 */
function anchor(href: string) {
  const esc = href.replace(/[/#]/g, "\\$&");
  const m = html.match(new RegExp(`<a ([^>]*\\bhref="${esc}"[^>]*)>([\\s\\S]*?)</a>`));
  expect(m, `no <a href="${href}"> in the masthead`).not.toBeNull();
  return { attrs: m![1], inner: m![2] };
}

describe("signed-out masthead markup (send-488)", () => {
  it("the sign-up CTA keeps the accessible name 'Get started for free' and shortens only the visible label", () => {
    const cta = anchor("/signup");
    expect(cta.attrs).toContain('aria-label="Get started for free"');
    // Both labels are present: the long one hides below 640px, the short one shows only there.
    expect(cta.inner).toMatch(/<span class="max-sm:hidden">Get started for free<\/span>/);
    expect(cta.inner).toMatch(/<span class="sm:hidden" aria-hidden="true">Get started<\/span>/);
    // The short label is the START of the accessible name (WCAG 2.5.3, label in name).
    expect("Get started for free".startsWith("Get started")).toBe(true);
  });

  it("neither Log in nor the CTA can wrap", () => {
    expect(anchor("/login").attrs).toMatch(/class="[^"]*\bwhitespace-nowrap\b/);
    expect(anchor("/signup").attrs).toMatch(/class="[^"]*\bwhitespace-nowrap\b/);
  });

  it("Log in is still a link to /login with that text", () => {
    expect(anchor("/login").inner).toBe("Log in");
  });

  it("the logo link has a 44px-tall hit area and keeps its image", () => {
    const logo = anchor("/");
    expect(logo.attrs).toMatch(/class="[^"]*\bmin-h-11\b/);
    expect(logo.inner).toContain('alt="Talentrah"');
    expect(logo.inner).toContain('src="/talentrah-horizontal.svg"');
    // The image's own sizing is unchanged (a hit-area change must not resize the logo).
    expect(logo.inner).toContain("h-6 w-auto flex-shrink-0 min-[480px]:h-8");
  });

  it("the hamburger is 44x44 and still labelled 'Main menu'", () => {
    const m = html.match(/<button type="button" aria-expanded="false" aria-haspopup="menu" aria-label="Main menu" class="([^"]*)"/);
    expect(m, "hamburger button not found").not.toBeNull();
    expect(m![1]).toContain("h-11 w-11");
    expect(m![1]).not.toContain("h-10 w-10");
  });

  it("the four nav links are unchanged and in order (bar and disclosure share them)", () => {
    const links = [...html.matchAll(/<a href="(\/#[a-z-]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    // The bar renders them once; the disclosure only when open, so a static render holds the bar's four.
    expect(links).toEqual([
      ["/#jobs", "Browse Jobs"],
      ["/#farah", "Meet Farah"],
      ["/#how-it-works", "How it works"],
      ["/#faqs", "FAQs"],
    ]);
  });

  it("every class the masthead had before this change is still there (desktop is not restyled)", () => {
    // The bar and its row.
    expect(html).toContain("sticky top-0 z-20 border-b-[2.5px] border-ink bg-paper/95 backdrop-blur-sm");
    expect(html).toMatch(/class="mx-auto flex h-\[78px\] max-w-\[1120px\] items-center justify-between px-10\b/);
    // The nav bar and its links.
    expect(html).toContain("flex items-center gap-2 max-[900px]:hidden");
    expect(html).toContain("flex min-h-11 items-center px-1 font-body text-[14.5px] font-semibold text-ink no-underline hover:text-rust");
    // The disclosure wrapper.
    expect(html).toContain("relative flex items-center min-[900px]:hidden");
    // The CTA: both the variant's own sizing and the (dead on desktop) override stay exactly as they were.
    const cta = anchor("/signup").attrs;
    for (const cls of ["min-h-[48px]", "px-[30px]", "py-[15px]", "text-[15px]", "min-h-11", "px-[22px]", "py-[11px]", "text-[14px]", "no-underline"]) {
      expect(cta, `CTA lost ${cls}`).toContain(cls);
    }
    // Log in keeps the ghost variant's sizing.
    const login = anchor("/login").attrs;
    for (const cls of ["min-h-[44px]", "px-[6px]", "py-[10px]", "text-[15px]", "no-underline"]) {
      expect(login, `Log in lost ${cls}`).toContain(cls);
    }
  });

  it("the phone-only changes are scoped below 640px, so nothing from 640px up depends on them", () => {
    const cta = anchor("/signup").attrs;
    const row = html.match(/class="(mx-auto flex h-\[78px\][^"]*)"/)![1];
    // Every added spacing class is a `max-sm:` variant; none is a bare utility that would apply on desktop.
    expect(row).toMatch(/max-sm:px-5/);
    expect(cta).toMatch(/max-sm:px-4/);
    expect(html).toMatch(/flex items-center gap-4 max-sm:gap-2/);
  });
});
