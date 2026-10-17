/**
 * ASSESSMENT-LINK-HOST-1: the employer sees where a candidate's response link goes BEFORE clicking it.
 *
 * The host is the address's hostname and nothing else: no path, no query (it can carry a token), no port, no user:password. It is lower-cased by the URL parser, and an internationalised
 * host is shown as punycode (`xn--...`) exactly as the parser gives it, so a look-alike domain (a Cyrillic "а" in "apple.com") is visible as the different name it is. The helper only
 * ever speaks about an address the page would make clickable (http or https): a javascript: address must never come out of it as a host, even though the URL parser happily reports
 * a hostname for `javascript://example.test/...`. When the address cannot be read, the page says so in plain words instead of guessing.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssessmentResponseView,
  LINK_HOST_FALLBACK,
  linkHostLabel,
  responseLinkHost,
} from "@/components/employer/assessment-response-view";

const sub = (over: Partial<Parameters<typeof AssessmentResponseView>[0]["submission"]> = {}) => ({ responseText: "plain", responseLink: null, submittedAt: "2026-10-13T09:00:00Z", responseFiles: [], ...over });
const render = (over: Parameters<typeof sub>[0] = {}) => renderToStaticMarkup(<AssessmentResponseView applicantName="Joy Akindele" jobTitle="Growth Marketer" submission={sub(over)} />);
/** What a person reads: tags and React's text-node separators removed. */
const visibleText = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

describe("responseLinkHost: the hostname and nothing else", () => {
  it("a normal https address gives its host, without the path, the query or the fragment", () => {
    expect(responseLinkHost("https://example.test/work")).toBe("example.test");
    expect(responseLinkHost("https://example.test/work?token=secret-value#frag")).toBe("example.test");
    expect(responseLinkHost("http://example.test/")).toBe("example.test");
  });

  it("is lower case, whatever case it was typed in", () => {
    expect(responseLinkHost("HTTPS://EXAMPLE.TEST/Work")).toBe("example.test");
    expect(responseLinkHost("https://Docs.Example.TEST/x")).toBe("docs.example.test");
  });

  it("leaves the port out", () => {
    expect(responseLinkHost("https://example.test:8443/x")).toBe("example.test");
    expect(responseLinkHost("http://127.0.0.1:3000/x")).toBe("127.0.0.1");
  });

  it("leaves credentials out: user:password@ never appears in the output", () => {
    const host = responseLinkHost("https://user:pass@example.test/x");
    expect(host).toBe("example.test");
    expect(host).not.toMatch(/user|pass|@/);
    expect(responseLinkHost("https://onlyuser@example.test/")).toBe("example.test");
  });

  it("shows an internationalised host as punycode, exactly as the parser gives it, so a look-alike is visible", () => {
    expect(responseLinkHost("https://münchen.example/x")).toBe("xn--mnchen-3ya.example");
    expect(responseLinkHost("https://xn--mnchen-3ya.example/x")).toBe("xn--mnchen-3ya.example");
    // A Cyrillic "а" (U+0430) in place of the Latin "a": it must NOT read as apple.com.
    const lookAlike = responseLinkHost("https://аpple.com/login");
    expect(lookAlike).toBe("xn--pple-43d.com");
    expect(lookAlike).not.toBe("apple.com");
  });

  it("keeps an IPv6 literal in its brackets", () => {
    expect(responseLinkHost("https://[::1]/x")).toBe("[::1]");
  });

  it("an invalid string has no host", () => {
    for (const bad of ["not a link at all", "https://", "https:evil.test", "//example.test/x", "example.test"]) expect(responseLinkHost(bad), bad).toBeNull();
  });

  it("a javascript: address never comes out as a host, including the one the URL parser reports a hostname for", () => {
    for (const script of ["javascript:alert(1)", "  javascript:alert(1)", "javascript://example.test/%0aalert(1)", "JAVASCRIPT://example.test/%0aalert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "ftp://example.test/file", "file:///etc/passwd"]) {
      expect(responseLinkHost(script), script).toBeNull();
      expect(linkHostLabel(script), script).toBe(LINK_HOST_FALLBACK);
      expect(linkHostLabel(script), script).not.toContain("example.test");
    }
  });

  it("empty, blank, null and undefined have no host", () => {
    for (const none of ["", "   ", null, undefined]) expect(responseLinkHost(none), String(none)).toBeNull();
  });

  it("linkHostLabel is the host when there is one, and the plain fallback sentence when there is not", () => {
    expect(linkHostLabel("https://example.test/x")).toBe("example.test");
    expect(LINK_HOST_FALLBACK).toBe("link address could not be read");
    expect(linkHostLabel("not a link")).toBe(LINK_HOST_FALLBACK);
    expect(linkHostLabel("")).toBe(LINK_HOST_FALLBACK);
  });
});

describe("the response view shows the host next to the control", () => {
  const LINK_WITH_EXTRAS = "https://user:pass@Files.Example.TEST:8443/shared/answer.pdf?token=super-secret-value&sig=abc#page=2";

  it("puts the host in its own element right after the 'Open response link' control", () => {
    const html = render({ responseLink: LINK_WITH_EXTRAS });
    const m = /<a [^>]*>Open response link<\/a><span data-testid="assessment-link-host"[^>]*>([^<]*)<\/span>/.exec(html.replace(/<!-- -->/g, ""));
    expect(m, "no host element directly after the control").not.toBeNull();
    expect(m![1]).toBe("Goes to files.example.test");
  });

  it("the visible text carries the host and none of the rest of the address (no path, query, port, credentials or fragment)", () => {
    const text = visibleText(render({ responseLink: LINK_WITH_EXTRAS }));
    expect(text).toContain("Goes to files.example.test");
    for (const secret of ["super-secret-value", "sig=abc", "user:pass", "pass@", "8443", "/shared", "answer.pdf", "page=2", "https://"]) expect(text, secret).not.toContain(secret);
  });

  it("the control itself is exactly as before: the same address, a new tab, rel noopener noreferrer", () => {
    const html = render({ responseLink: "https://example.test/work" });
    expect(html).toContain('href="https://example.test/work"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Open response link");
  });

  it("an address that is not a web address gets no host and no clickable control", () => {
    for (const bad of ["javascript:alert(1)", "javascript://example.test/%0aalert(1)", "data:text/html,x", "ftp://example.test/f", "not a link at all", "https:evil.test"]) {
      const html = render({ responseText: "x", responseLink: bad });
      expect(html, bad).not.toContain("assessment-link-host");
      expect(html, bad).not.toContain("Open response link");
      expect(html, bad).not.toContain("Goes to");
    }
  });

  it("no link at all shows no host", () => {
    for (const none of ["", "   ", null]) expect(render({ responseText: "x", responseLink: none }), JSON.stringify(none)).not.toContain("assessment-link-host");
  });

  it("the host can wrap or shrink instead of pushing the page sideways, and is not machine-translated", () => {
    const html = render({ responseLink: `https://${"a".repeat(60)}.${"b".repeat(60)}.example.test/x` });
    const cls = /<span data-testid="assessment-link-host"[^>]*class="([^"]*)"/.exec(html);
    expect(cls, "host element").not.toBeNull();
    expect(cls![1]).toContain("break-all");
    expect(cls![1]).toContain("min-w-0");
    expect(html).toContain('translate="no"');
    expect(html).not.toMatch(/overflow-x-(scroll|auto)|whitespace-nowrap/);
  });
});
