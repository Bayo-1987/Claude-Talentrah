/**
 * /offline: self-contained, honest, editorial (build prompt section 2). The styled-offline behaviour in a real browser is
 * e2e/pwa-offline.spec.ts; this reads the HTML the route serves.
 */
import { describe, expect, it } from "vitest";
import { GET, dynamic } from "@/app/offline/route";
import { OFFLINE_PALETTE, OFFLINE_PAGE_HTML } from "@/lib/pwa/offline-page";
import { STATIC_PATHS } from "@/app/sitemap";
import { tokenHex } from "../support/oklch";

const html = OFFLINE_PAGE_HTML;

describe("the /offline route", () => {
  it("answers 200 with the complete document", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(html);
  });

  it("sends the stated headers and no Cache-Control that forbids storing it", () => {
    const res = GET();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control") ?? "").not.toMatch(/no-store|private/);
  });

  it("is prerendered (a GET route handler is dynamic by default, which would make every offline fetch a function invocation)", () => {
    expect(dynamic).toBe("force-static");
  });

  it("is not in the sitemap", () => {
    expect(STATIC_PATHS.map((p) => p.path)).not.toContain("/offline");
  });
});

describe("the page makes no external request of any kind", () => {
  it("has no script, stylesheet link, image, iframe, font, import or url() reference", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<iframe|<object|<embed|<video|<audio|<source/i);
    expect(html).not.toMatch(/@import|url\(|@font-face/i);
    expect(html).not.toMatch(/\/_next/);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it("has exactly one <link>: an icon whose href is an empty data: URL, which the browser never requests", () => {
    const links = html.match(/<link[^>]*>/gi) ?? [];
    expect(links).toEqual(['<link rel="icon" href="data:,">']);
  });

  it("every src and href is either empty (the retry link) or the inert data: icon", () => {
    const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/gi)].map((m) => m[1]);
    expect(refs.sort()).toEqual(["", "data:,"]);
  });
});

describe("the retry is a plain link that re-requests the page the person wanted", () => {
  it("is an anchor with an empty href (it resolves to the current document URL) and carries no script", () => {
    expect(html).toMatch(/<a class="retry" href="">Try again<\/a>/);
    expect(html).not.toMatch(/onclick|javascript:/i);
  });

  it("is styled as a button at least 44px high", () => {
    expect(html).toMatch(/\.retry\{[^}]*min-height:44px/);
  });
});

describe("editorial and honest", () => {
  it("sets border-radius to 0 and never gives anything a radius or a shadow", () => {
    expect(html).toContain("border-radius:0");
    expect(html).not.toMatch(/border-radius:\s*[1-9]/);
    expect(html).not.toMatch(/box-shadow|text-shadow/);
  });

  it("uses no emoji", () => {
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("says plainly that the person is offline and that pages are not saved on the phone", () => {
    expect(html).toMatch(/You are offline/);
    expect(html).toMatch(/Pages are not saved on this phone/);
  });

  it("is a real document: doctype, lang, charset, viewport, noindex", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });
});

describe("the hex colours are the design tokens they were converted from", () => {
  it.each([
    ["paper", "paper"],
    ["ink", "ink"],
    ["inkSoft", "ink-soft"],
    ["rust", "rust"],
    ["rustHover", "rust-hover"],
    ["line", "line"],
  ] as const)("%s", (key, token) => {
    expect(OFFLINE_PALETTE[key]).toBe(tokenHex(token));
  });
});
