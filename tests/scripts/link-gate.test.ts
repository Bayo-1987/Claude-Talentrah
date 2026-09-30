/**
 * send-477 — the logic behind the signed-out gated-link check. No network: a
 * fixture `FetchLike` stands in for `fetch`, exactly as tests/scripts/
 * link-check.test.ts does for send-384's checker.
 *
 * The important part is the FIXTURE SITE at the bottom. A check that reports
 * "no gated links" is indistinguishable from a check that cannot find any, so
 * the crawler is run against a small site that DELIBERATELY contains gated
 * links — in the footer, in main content, on a 404 page, to an admin route —
 * next to clean links, and must flag exactly the gated ones. A second fixture
 * with no gated links must report none.
 */
import { describe, expect, it } from "vitest";
import {
  crawlSignedOutLinks,
  extractRegionLinks,
  loginRedirectKind,
  offenderKey,
  pageGroup,
  type FetchLike,
  type FetchLikeResponse,
  type LinkCheckResult,
} from "../../scripts/link-check";

const PAGE = "http://site.test/";

describe("extractRegionLinks", () => {
  const html = `
    <header><a href="/about">About</a></header>
    <main><a href="/m">M</a></main>
    <footer><a href="/f">F</a></footer>`;

  it("labels each anchor header, main or footer by the element it sits in", () => {
    const links = extractRegionLinks(html, PAGE);
    expect(links.map((l) => [l.region, l.pathname])).toEqual([
      ["header", "/about"],
      ["main", "/m"],
      ["footer", "/f"],
    ]);
  });

  it("treats an anchor outside any header/footer as main, even after a <main> has closed", () => {
    const links = extractRegionLinks(`<main></main><a href="/loose">x</a><footer><a href="/f">F</a></footer>`, PAGE);
    expect(links.map((l) => [l.region, l.pathname])).toEqual([
      ["main", "/loose"],
      ["footer", "/f"],
    ]);
  });

  it("keeps only same-origin links and drops fragments, mailto, tel and javascript", () => {
    const links = extractRegionLinks(
      `<a href="https://other.example/x">o</a><a href="mailto:a@b.c">m</a><a href="tel:1">t</a>
       <a href="javascript:void(0)">j</a><a href="#top">h</a><a href="/keep#frag">k</a>`,
      PAGE,
    );
    expect(links.map((l) => l.url)).toEqual(["http://site.test/keep"]);
  });

  it("splits pathname from query and decodes &amp; in the href", () => {
    const [link] = extractRegionLinks(`<a href="/tailor?coverLetter=1&amp;x=2">c</a>`, PAGE);
    expect(link.pathname).toBe("/tailor");
    expect(link.search).toBe("?coverLetter=1&x=2");
  });

  it("still finds an anchor whose class attribute contains a '>' before its href (send-384's pattern stops at that '>')", () => {
    const html = `<a class="inline-flex [&>svg]:h-4" href="/tracker">Job Tracker</a>`;
    expect(extractRegionLinks(html, PAGE).map((l) => l.pathname)).toEqual(["/tracker"]);
  });

  it("collapses whitespace and tags in the link text", () => {
    const [link] = extractRegionLinks(`<a href="/x"> Browse\n  <span>jobs</span>  →</a>`, PAGE);
    expect(link.text).toBe("Browse jobs →");
  });

  it("de-duplicates the same link within a region but not across regions", () => {
    const links = extractRegionLinks(
      `<main><a href="/j">a</a><a href="/j">b</a></main><footer><a href="/j">c</a></footer>`,
      PAGE,
    );
    expect(links.map((l) => l.region)).toEqual(["main", "footer"]);
  });

  it("counts the production canonical origin as internal only when told to, and rewrites it onto the page's origin", () => {
    const withAbsolute = `<a href="https://www.talentrah.com/tracker">t</a>`;
    expect(extractRegionLinks(withAbsolute, PAGE)).toEqual([]);
    const [link] = extractRegionLinks(withAbsolute, PAGE, { internalOrigins: ["https://www.talentrah.com"] });
    expect(link.url).toBe("http://site.test/tracker");
  });
});

describe("pageGroup", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/about", "/about"],
    ["/about/", "/about"],
    ["/jobs/1ad10994", "/jobs/*"],
    // Deliberately coarse: a landing page under /jobs shares the detail pages' group.
    ["/jobs/remote", "/jobs/*"],
    ["/blog/some-post/extra", "/blog/*"],
  ])("%s -> %s", (path, group) => {
    expect(pageGroup(path)).toBe(group);
  });
});

describe("offenderKey", () => {
  it("keys main-content links by page group and the full target including query", () => {
    expect(offenderKey("main", "/blog/*", "/tailor?coverLetter=1")).toBe("main:/blog/* -> /tailor?coverLetter=1");
  });
  it("keys header and footer links sitewide, whatever page they were found on", () => {
    expect(offenderKey("footer", "/about", "/jobs")).toBe("footer:* -> /jobs");
    expect(offenderKey("header", "/jobs/*", "/jobs")).toBe("header:* -> /jobs");
  });
});

describe("loginRedirectKind", () => {
  const chain = (...hops: string[]): LinkCheckResult => ({
    url: hops[0],
    kind: "redirect-chain",
    hops,
    finalStatus: 200,
  });

  it("flags a chain whose later hop is /login", () => {
    expect(loginRedirectKind(chain("http://s/tracker", "http://s/login?redirectTo=%2Ftracker"))).toBe("login");
  });
  it("flags an INTERMEDIATE hop to /login, not just the final URL", () => {
    expect(loginRedirectKind(chain("http://s/a", "http://s/b", "http://s/login", "http://s/welcome"))).toBe("login");
  });
  it("flags /admin/login separately, since it is a different gate", () => {
    expect(loginRedirectKind(chain("http://s/admin/x", "http://s/admin/login?redirectTo=%2Fadmin%2Fx"))).toBe(
      "admin-login",
    );
  });
  it("flags a chain that reaches /login and then fails", () => {
    const broken: LinkCheckResult = {
      url: "http://s/tracker",
      kind: "broken",
      status: 500,
      chain: ["http://s/tracker", "http://s/login"],
    };
    expect(loginRedirectKind(broken)).toBe("login");
  });
  it("does not flag a direct 200, a plain redirect elsewhere, or a link TO /login", () => {
    expect(loginRedirectKind({ url: "http://s/x", kind: "ok", body: "" })).toBeNull();
    expect(loginRedirectKind(chain("http://s/old", "http://s/new"))).toBeNull();
    // /login as the FIRST hop is the destination the link asked for, not a redirect to it.
    expect(loginRedirectKind({ url: "http://s/login", kind: "ok", body: "" })).toBeNull();
  });
});

// ── the fixture site ────────────────────────────────────────────────────────

function res(status: number, opts: { location?: string; body?: string } = {}): FetchLikeResponse {
  return {
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? (opts.location ?? null) : null) },
    text: async () => opts.body ?? "",
  };
}

const BASE = "http://site.test";
const gate = (path: string) => res(307, { location: `/login?redirectTo=${encodeURIComponent(path)}` });

function siteFetch(pages: Record<string, FetchLikeResponse>, track?: { inFlight: number; max: number }): FetchLike {
  return async (url) => {
    if (track) {
      track.inFlight += 1;
      track.max = Math.max(track.max, track.inFlight);
      await new Promise((r) => setTimeout(r, 2));
      track.inFlight -= 1;
    }
    const u = new URL(url);
    return pages[u.pathname + u.search] ?? res(404, { body: "" });
  };
}

const CLEAN_TARGETS: Record<string, FetchLikeResponse> = {
  "/login": res(200, { body: "login page" }),
  "/pricing": res(200, { body: "ok" }),
  "/scholarships/apply-now": res(200, { body: "ok" }),
};

const GATED_TARGETS: Record<string, FetchLikeResponse> = {
  "/jobs": gate("/jobs"),
  "/tracker": gate("/tracker"),
  "/tracker?x=1": gate("/tracker?x=1"),
  "/tailor?coverLetter=1": gate("/tailor?coverLetter=1"),
  "/admin/panel": res(307, { location: "/admin/login?redirectTo=%2Fadmin%2Fpanel" }),
};

const FOOTER = `<footer><a href="/tracker">Job Tracker</a><a href="/pricing">Pricing</a></footer>`;

const SITE: Record<string, FetchLikeResponse> = {
  ...CLEAN_TARGETS,
  ...GATED_TARGETS,
  "/": res(200, {
    body: `<header><a href="/pricing">Pricing</a><a href="/login">Log in</a></header>
           <main><a href="/jobs">Browse jobs</a><a href="/scholarships/apply-now">Apply</a></main>${FOOTER}`,
  }),
  "/about": res(200, {
    body: `<main><a href="/admin/panel">Admin</a><a href="https://www.talentrah.com/tracker?x=1">abs</a></main>${FOOTER}`,
  }),
  "/blog/post": res(200, { body: `<main><a href="/tailor?coverLetter=1">Cover letter</a></main>${FOOTER}` }),
  "/__404__": res(404, { body: `<main><a href="/jobs">Browse jobs</a></main>${FOOTER}` }),
};

describe("crawlSignedOutLinks against a fixture site that deliberately contains gated links", () => {
  const sources = [
    { path: "/" },
    { path: "/about" },
    { path: "/blog/post" },
    { path: "/__404__", group: "404" },
  ];
  const run = () =>
    crawlSignedOutLinks({
      baseUrl: BASE,
      sources,
      fetchImpl: siteFetch(SITE),
      internalOrigins: ["https://www.talentrah.com"],
      concurrency: 3,
    });

  it("flags exactly the gated links — footer, main, 404 page, admin, and an absolute canonical-origin link — with their keys", async () => {
    const report = await run();
    expect(report.observations.map((o) => o.key).sort()).toEqual(
      [
        "footer:* -> /tracker",
        "main:/ -> /jobs",
        "main:/about -> /admin/panel",
        "main:/about -> /tracker?x=1",
        "main:/blog/* -> /tailor?coverLetter=1",
        "main:404 -> /jobs",
      ].sort(),
    );
  });

  it("leaves the clean links alone (a link TO /login, /pricing and the public apply-now hub)", async () => {
    const report = await run();
    const keys = report.observations.map((o) => o.target);
    for (const clean of ["/pricing", "/login", "/scholarships/apply-now"]) expect(keys).not.toContain(clean);
    expect(report.targets.find((t) => t.pathname === "/pricing")?.login).toBeNull();
    expect(report.targets.find((t) => t.pathname === "/login")?.login).toBeNull();
  });

  it("records every page a footer link was seen on, and the link text", async () => {
    const report = await run();
    const footer = report.observations.find((o) => o.key === "footer:* -> /tracker")!;
    expect(footer.sourcePaths).toEqual(["/", "/__404__", "/about", "/blog/post"]);
    expect(footer.texts).toEqual(["Job Tracker"]);
  });

  it("marks /admin/login redirects as their own kind, not as /login", async () => {
    const report = await run();
    expect(report.targets.find((t) => t.pathname === "/admin/panel")?.login).toBe("admin-login");
    expect(report.targets.find((t) => t.pathname === "/tracker")?.login).toBe("login");
  });

  it("reports what it covered, so a run that reached nothing cannot look clean", async () => {
    const report = await run();
    expect(report.sourcesFetched).toBe(4);
    expect(report.sourceFailures).toEqual([]);
    expect(report.groupCounts).toEqual({ "/": 1, "/about": 1, "/blog/*": 1, "404": 1 });
  });

  it("follows each distinct target once, whatever number of pages link to it", async () => {
    const calls: string[] = [];
    const counting: FetchLike = async (url, init) => {
      calls.push(new URL(url).pathname + new URL(url).search);
      return siteFetch(SITE)(url, init);
    };
    await crawlSignedOutLinks({ baseUrl: BASE, sources, fetchImpl: counting, internalOrigins: ["https://www.talentrah.com"] });
    expect(calls.filter((c) => c === "/tracker").length).toBe(1);
  });

  it("respects the concurrency limit", async () => {
    const track = { inFlight: 0, max: 0 };
    await crawlSignedOutLinks({ baseUrl: BASE, sources, fetchImpl: siteFetch(SITE, track), concurrency: 2 });
    expect(track.max).toBeLessThanOrEqual(2);
    expect(track.max).toBeGreaterThan(0);
  });

  it("reports a source that cannot be read instead of silently skipping it", async () => {
    const report = await crawlSignedOutLinks({
      baseUrl: BASE,
      sources: [{ path: "/" }, { path: "/gone" }, { path: "/moved" }, { path: "/boom" }],
      fetchImpl: siteFetch({ ...SITE, "/moved": res(301, { location: "/about" }), "/boom": res(500) }),
    });
    expect(report.sourcesFetched).toBe(1);
    expect(report.sourceFailures.map((f) => f.path).sort()).toEqual(["/boom", "/gone", "/moved"]);
  });
});

describe("crawlSignedOutLinks against a fixture site with NO gated links", () => {
  it("reports none — the clean case, so the flagged case above is not just 'always flags'", async () => {
    const report = await crawlSignedOutLinks({
      baseUrl: BASE,
      sources: [{ path: "/" }],
      fetchImpl: siteFetch({
        ...CLEAN_TARGETS,
        "/": res(200, { body: `<header><a href="/pricing">P</a></header><main><a href="/scholarships/apply-now">A</a></main>` }),
      }),
    });
    expect(report.observations).toEqual([]);
    expect(report.targets.length).toBe(2);
  });
});
