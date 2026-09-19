/**
 * The pure logic behind send-384's broken-link check. No network — a
 * fixture `FetchLike` stands in for the real `fetch`, so this exercises
 * every branch (200, 404, a redirect chain, a soft-404, a redirect with no
 * Location header, a network error, too many redirects) deterministically.
 * scripts/check-broken-links.ts is the thing that actually calls `fetch` for
 * real, against the real live sitemap and site — this file is the "does the
 * checker's OWN logic correctly flag a deliberately-broken fixture and leave
 * a working one alone" test the ticket asked for.
 */
import { describe, expect, it } from "vitest";
import {
  classifyUrl,
  extractLinks,
  looksLikeSoftNotFound,
  parseSitemapUrls,
  type FetchLike,
  type FetchLikeResponse,
} from "../../scripts/link-check";

function response(status: number, opts: { location?: string; body?: string } = {}): FetchLikeResponse {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? (opts.location ?? null) : null) },
    text: async () => opts.body ?? "",
  };
}

/** A fixture FetchLike backed by a plain url -> response map. */
function fakeFetch(map: Record<string, FetchLikeResponse | (() => FetchLikeResponse)>): FetchLike {
  return async (url) => {
    const entry = map[url];
    if (!entry) throw new Error(`fakeFetch: no fixture for ${url}`);
    return typeof entry === "function" ? entry() : entry;
  };
}

describe("parseSitemapUrls", () => {
  it("reads every <loc> entry", () => {
    const xml =
      "<urlset><url><loc>https://www.talentrah.com/</loc></url>" +
      "<url><loc>https://www.talentrah.com/jobs/abc</loc></url></urlset>";
    expect(parseSitemapUrls(xml)).toEqual([
      "https://www.talentrah.com/",
      "https://www.talentrah.com/jobs/abc",
    ]);
  });

  it("returns an empty list for a document with no <loc> tags, rather than throwing", () => {
    expect(parseSitemapUrls("<urlset></urlset>")).toEqual([]);
  });
});

describe("extractLinks", () => {
  const page = "https://www.talentrah.com/jobs/abc";

  it("splits same-origin from cross-origin hrefs", () => {
    const html = `
      <a href="/jobs">Jobs</a>
      <a href="https://www.talentrah.com/tracker">Tracker</a>
      <a href="https://jobs.workable.com/view/xyz">Apply</a>
    `;
    const { internal, external } = extractLinks(html, page);
    expect(internal).toEqual(["https://www.talentrah.com/jobs", "https://www.talentrah.com/tracker"]);
    expect(external).toEqual(["https://jobs.workable.com/view/xyz"]);
  });

  it("resolves a relative href against the page it was found on", () => {
    const { internal } = extractLinks(`<a href="../tracker">Tracker</a>`, page);
    expect(internal).toEqual(["https://www.talentrah.com/tracker"]);
  });

  it("drops #-only, mailto:, tel: and javascript: hrefs", () => {
    const html = `
      <a href="#">Top</a>
      <a href="mailto:hello@talentrah.com">Email</a>
      <a href="tel:+2340000000">Call</a>
      <a href="javascript:void(0)">Nothing</a>
    `;
    const { internal, external } = extractLinks(html, page);
    expect(internal).toEqual([]);
    expect(external).toEqual([]);
  });

  it("strips the fragment and dedupes two hrefs that differ only by it", () => {
    const html = `<a href="/jobs#top">A</a><a href="/jobs#bottom">B</a>`;
    const { internal } = extractLinks(html, page);
    expect(internal).toEqual(["https://www.talentrah.com/jobs"]);
  });

  it("ignores an unresolvable href instead of throwing", () => {
    // An unencoded space in the host is invalid even as an absolute URL —
    // WHATWG's URL parser throws on it rather than silently accepting it.
    const { internal, external } = extractLinks(`<a href="http://bad host.example/x">Bad</a>`, page);
    expect(internal).toEqual([]);
    expect(external).toEqual([]);
  });
});

describe("looksLikeSoftNotFound", () => {
  it("matches this app's real not-found page by its <title>", () => {
    expect(
      looksLikeSoftNotFound("<head><title>Page not found — Talentrah</title></head><body>...</body>"),
    ).toBe(true);
  });

  it("does not flag an ordinary page that happens to mention 404 in passing", () => {
    expect(looksLikeSoftNotFound("<p>Our error rate dropped from 404 incidents to 12.</p>")).toBe(false);
  });

  it("does NOT flag a real, healthy page even though it visibly contains the not-found page's own copy", () => {
    // The exact false positive this function's first implementation had on
    // its first real run: Next's App Router serializes the not-found
    // boundary's rendered output (including its visible "This page doesn't
    // exist." copy) into the RSC Flight payload of EVERY page, healthy or
    // not — a raw substring search on that text alone flagged 100% of the
    // live site, including the homepage. The <title> tag is not duplicated
    // into that payload, so it stays a reliable, page-specific signal.
    const realPageWithEmbeddedFlightPayload =
      '<head><title>AI Job Search Copilot — Talentrah</title></head><body>' +
      '<script>self.__next_f.push([1,"...[\\"$\\",\\"h1\\",null,{\\"children\\":\\"This page doesn\'t exist.\\"}]..."])</script>' +
      "</body>";
    expect(looksLikeSoftNotFound(realPageWithEmbeddedFlightPayload)).toBe(false);
  });
});

describe("classifyUrl", () => {
  const OK_URL = "https://www.talentrah.com/about";
  const BROKEN_URL = "https://www.talentrah.com/gone";
  const SOFT_404_URL = "https://www.talentrah.com/soft-404";

  it("flags a real 404 as broken, and never flags a real 200 as broken (the fixture pair the ticket asked for)", async () => {
    const fetchImpl = fakeFetch({
      [OK_URL]: response(200, { body: "<html>About Talentrah</html>" }),
      [BROKEN_URL]: response(404),
    });

    const ok = await classifyUrl(OK_URL, fetchImpl);
    expect(ok.kind).toBe("ok");

    const broken = await classifyUrl(BROKEN_URL, fetchImpl);
    expect(broken).toEqual({ url: BROKEN_URL, kind: "broken", status: 404 });
  });

  it("classifies a 500 as broken with its real status", async () => {
    const fetchImpl = fakeFetch({ [BROKEN_URL]: response(500) });
    const result = await classifyUrl(BROKEN_URL, fetchImpl);
    expect(result).toEqual({ url: BROKEN_URL, kind: "broken", status: 500 });
  });

  it("flags a 200 that is actually this app's own not-found page as soft-404, not ok", async () => {
    const fetchImpl = fakeFetch({
      [SOFT_404_URL]: response(200, { body: "<title>Page not found — Talentrah</title>" }),
    });
    const result = await classifyUrl(SOFT_404_URL, fetchImpl);
    expect(result).toEqual({ url: SOFT_404_URL, kind: "soft-404" });
  });

  it("follows a redirect chain and reports it distinctly from a plain 200 once it lands", async () => {
    const start = "https://www.talentrah.com/old-jobs";
    const middle = "https://www.talentrah.com/jobs-v2";
    const final = "https://www.talentrah.com/jobs";
    const fetchImpl = fakeFetch({
      [start]: response(301, { location: middle }),
      [middle]: response(302, { location: final }),
      [final]: response(200, { body: "<html>Jobs</html>" }),
    });

    const result = await classifyUrl(start, fetchImpl);
    expect(result).toEqual({
      url: start,
      kind: "redirect-chain",
      hops: [start, middle, final],
      finalStatus: 200,
    });
  });

  it("reports a redirect that dead-ends on a non-200 as broken, with the hops that led there", async () => {
    const start = "https://www.talentrah.com/employer";
    const loginUrl = "https://www.talentrah.com/login?redirectTo=%2Femployer";
    const fetchImpl = fakeFetch({
      [start]: response(307, { location: loginUrl }),
      [loginUrl]: response(404),
    });

    const result = await classifyUrl(start, fetchImpl);
    expect(result).toEqual({
      url: start,
      kind: "broken",
      status: 404,
      chain: [start, loginUrl],
    });
  });

  it("reports a redirect with no Location header as broken rather than looping", async () => {
    const url = "https://www.talentrah.com/broken-redirect";
    const fetchImpl = fakeFetch({ [url]: response(302) });
    const result = await classifyUrl(url, fetchImpl);
    expect(result).toEqual({ url, kind: "broken", status: 302, chain: [url] });
  });

  it("gives up after maxRedirects hops rather than following forever", async () => {
    const fetchImpl: FetchLike = async (url) => {
      const n = Number(url.split("/").pop());
      return response(301, { location: `https://example.com/${n + 1}` });
    };
    const result = await classifyUrl("https://example.com/0", fetchImpl, { maxRedirects: 3 });
    expect(result.kind).toBe("too-many-redirects");
  });

  it("reports a network failure as an error, not a silent pass", async () => {
    const url = "https://www.talentrah.com/times-out";
    const fetchImpl: FetchLike = async () => {
      throw new Error("fetch failed: getaddrinfo ENOTFOUND");
    };
    const result = await classifyUrl(url, fetchImpl);
    expect(result).toEqual({ url, kind: "error", message: "fetch failed: getaddrinfo ENOTFOUND" });
  });
});
