/**
 * safeRedirectTo (src/lib/auth/redirect-to.ts): the one check between a `redirectTo` / `next` value that arrives from a query string, a hidden field or a cookie and a redirect. It must hand back a path ON THIS SITE or the
 * fallback, judged the way a browser reads it, so the tests resolve every accepted value with the WHATWG URL parser (new URL(value, "https://talentrah.test")), which behaves like a browser: browsers drop tab, line feed and
 * carriage return from a URL before parsing, so "/<tab>/host" would be read as "//host". No test here depends on the function's own rules, only on where its answer resolves.
 */
import { describe, expect, it } from "vitest";
import { onboardingDestination, safeRedirectTo } from "@/lib/auth/redirect-to";

const SITE = "https://talentrah.test";
const FALLBACK = "/FALLBACK";
const resolve = (path: string) => new URL(path, SITE);
const safe = (raw: unknown) => safeRedirectTo(raw, FALLBACK);

/** Every accepted answer must stay on the site, and must not be protocol-relative once resolved. */
function assertStaysOnSite(input: unknown, out: string): void {
  if (out === FALLBACK) return;
  const url = resolve(out);
  expect(url.origin, `${JSON.stringify(input)} was accepted as ${JSON.stringify(out)}`).toBe(SITE);
  expect(url.pathname.startsWith("//"), `${JSON.stringify(input)} resolves to a path that starts with //`).toBe(false);
}

const CONTROL_CHARS = [...Array.from({ length: 0x21 }, (_, i) => String.fromCharCode(i)), "\u007f"];
const name = (c: string) => (c === "\u007f" ? "DEL" : `0x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

describe("an accepted value always resolves to this site (the browser's reading, not the function's own rules)", () => {
  it("holds for every combination of up to three characters after the first slash, over a hostile alphabet", () => {
    const alphabet = ["/", "\\", "\t", "\n", "\r", "\u000b", "\f", "\0", "\u007f", " ", "\u0085", " ", " ", " ", "﻿", "​", "／", "∕", "＼", "。", "a", ".", "%09", "%0a", "%0d", "%5c", "%2f", "%2e", "%2E", "..", ":", "@", "?", "#", "example.test"];
    let checked = 0;
    for (const a of alphabet) {
      assertStaysOnSite(`/${a}`, safe(`/${a}`));
      checked++;
      for (const b of alphabet) {
        assertStaysOnSite(`/${a}${b}`, safe(`/${a}${b}`));
        checked++;
        for (const c of alphabet) {
          const v = `/${a}${b}${c}example.test`;
          assertStaysOnSite(v, safe(v));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });

  it.each([
    ["a tab", "/\t/example.test"],
    ["a line feed", "/\n/example.test"],
    ["a carriage return", "/\r/example.test"],
    ["a tab between a slash and a backslash", "/\t\\example.test"],
  ])("the browser-stripped characters: %s", (_n, value) => {
    // Document what the parser does with the raw value, so the premise of the whole file is itself checked.
    expect(resolve(value).origin, "premise: a browser leaves the site for this raw value").not.toBe(SITE);
    assertStaysOnSite(value, safe(value));
    expect(safe(value)).toBe(FALLBACK);
  });
});

describe("hostile values return the fallback", () => {
  it.each(CONTROL_CHARS.filter((c) => c !== " ").map((c) => [name(c), c] as const))("a control character (%s) anywhere after the first slash", (_n, c) => {
    for (const value of [`/${c}/example.test`, `/a${c}b`, `/jobs${c}`, `/jobs?x=1${c}y=2`, `/jobs#top${c}`, `/${c}`]) {
      // `trim()` removes whitespace at the very END of a value (tab, line feed, vertical tab, form feed, carriage return): there the character is outer whitespace and the trimmed value is what counts (checked below).
      if (!/[\u0000-\u0020\u007f]/.test(value.trim())) continue;
      expect(safe(value), JSON.stringify(value)).toBe(FALLBACK);
    }
  });

  it("a space anywhere inside the value (0x20)", () => {
    for (const value of ["/a b", "/ /example.test", "/jobs?q=a b"]) expect(safe(value), JSON.stringify(value)).toBe(FALLBACK);
  });

  it.each([
    ["a backslash anywhere", "/a\\b"],
    ["a backslash after a plain path", "/jobs\\evil"],
    ["a leading backslash pair", "/\\example.test"],
    ["a slash then a backslash host", "/\\\\example.test"],
    ["a doubled slash host", "//example.test"],
    ["a doubled slash host with a path", "//example.test/x"],
    ["an absolute URL", "https://example.test/"],
    ["an absolute URL on this host", "https://talentrah.test/jobs"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,x"],
    ["a bare host", "example.test"],
    ["a relative path with no slash", "jobs"],
    ["an empty string", ""],
    ["only spaces", "   "],
  ])("%s", (_n, value) => expect(safe(value)).toBe(FALLBACK));

  it.each([
    ["a dot segment that leaves a protocol-relative path", "/.//example.test"],
    ["a parent segment that leaves a protocol-relative path", "/..//example.test"],
    ["a percent-encoded dot segment", "/%2e//example.test"],
    ["a mixed-case percent-encoded dot segment", "/%2E//example.test"],
    ["a deeper dot segment", "/a/..//example.test"],
  ])("%s resolves to a path starting with // and is refused", (_n, value) => {
    expect(resolve(value).pathname.startsWith("//"), "premise: the parser leaves a // path").toBe(true);
    expect(safe(value)).toBe(FALLBACK);
  });

  it("anything that is not a string", () => {
    for (const value of [undefined, null, 0, 1, true, {}, [], ["/jobs"], () => "/jobs"]) expect(safe(value)).toBe(FALLBACK);
  });

  it("every control character in the middle of an otherwise legitimate path, one at a time", () => {
    for (const c of CONTROL_CHARS) expect(safe(`/jobs${c}abc`), JSON.stringify(`/jobs${c}abc`)).toBe(FALLBACK);
  });
});

describe("percent-encoded variants are plain path text, kept only because they resolve to this site", () => {
  it.each([
    ["%09", "/%09/example.test"],
    ["%0a", "/%0a/example.test"],
    ["%0d", "/%0d/example.test"],
    ["%5c", "/%5c/example.test"],
    ["%5c at the start of the next segment", "/%5cexample.test"],
    ["%2f", "/%2f/example.test"],
  ])("%s", (_n, value) => {
    expect(resolve(value).origin).toBe(SITE);
    expect(safe(value)).toBe(value);
    assertStaysOnSite(value, safe(value));
  });
});

describe("legitimate paths pass byte for byte", () => {
  it.each(["/", "/jobs", "/jobs/abc-123?x=1&y=2#top", "/employer/campaigns", "/onboarding", "/blog/some-slug", "/jobs?q=data%20analyst&page=2", "/tracker?stage=applied", "/welcome/country?next=%2Fjobs%2Fabc", "/a/b/c/d.html", "/x?redirectTo=%2Fjobs"])("%s", (value) => {
    expect(safe(value)).toBe(value);
    assertStaysOnSite(value, safe(value));
  });

  it("outer whitespace is still trimmed, and the trimmed value is what is checked", () => {
    expect(safe("  /jobs  ")).toBe("/jobs");
    expect(safe("\n/jobs\t")).toBe("/jobs");
    expect(safe("  //example.test")).toBe(FALLBACK);
  });

  it("the fallback is returned as given (including an empty one)", () => {
    expect(safeRedirectTo("nope", "")).toBe("");
    expect(safeRedirectTo("/\t/example.test", "")).toBe("");
  });
});

describe("a caller that builds on it", () => {
  it("onboardingDestination carries a safe value and drops a hostile one", () => {
    expect(onboardingDestination("/jobs/abc")).toBe(`/onboarding?next=${encodeURIComponent("/jobs/abc")}`);
    expect(onboardingDestination("/\t/example.test")).toBe("/onboarding");
    expect(onboardingDestination("/\n/example.test")).toBe("/onboarding");
  });
});
