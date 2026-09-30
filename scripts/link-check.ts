/**
 * Pure logic behind send-384's broken-link check: sitemap parsing,
 * same-origin/external link extraction from a page's own HTML, this app's
 * soft-404 detection, and classifying one URL's fetch outcome.
 *
 * No network anywhere in this file. `scripts/check-broken-links.ts` does the
 * real fetching (against the real live sitemap and the real live site) and
 * imports these functions — keeping them here, fetch-free, is what makes
 * `tests/scripts/link-check.test.ts` able to exercise every branch (a real
 * 200, a 404, a redirect chain, a soft-404, a network error) with a fixture
 * `fetchImpl` instead of a live server.
 */

/** Parses a sitemap.xml document's <loc> entries into a plain URL list. */
export function parseSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

export interface ExtractedLinks {
  /** Same-origin as the page they were found on. */
  internal: string[];
  /** A different origin — apply links, scholarship provider pages, etc. */
  external: string[];
}

/**
 * `<a href="...">` targets on a page, split into same-origin (`internal`)
 * and cross-origin (`external`), each deduplicated and with any `#fragment`
 * stripped (a same-page anchor to a different fragment is not a different
 * link to check). Excludes `#`-only, `mailto:`, `tel:` and `javascript:`
 * hrefs, and anything that isn't `http(s)` once resolved — none of those are
 * a page this check can meaningfully fetch.
 */
export function extractLinks(html: string, pageUrl: string): ExtractedLinks {
  const origin = new URL(pageUrl).origin;
  const hrefs = [...html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);

  const internal = new Set<string>();
  const external = new Set<string>();
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue; // Not a resolvable URL — nothing this check can fetch.
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    url.hash = "";
    (url.origin === origin ? internal : external).add(url.toString());
  }
  return { internal: [...internal], external: [...external] };
}

/**
 * The literal `<title>` this app's own `not-found.tsx` sets via
 * `pageMetadata()` (src/app/not-found.tsx) — deliberately NOT a substring
 * search for the page's visible copy ("This page doesn't exist."), which was
 * this function's first implementation and produced a 100% false-positive
 * rate on the real live site the first time this checker actually ran: every
 * single page, including the homepage, flagged as a soft-404.
 *
 * Root cause, found by fetching the live homepage and searching for the
 * marker text directly: Next's App Router serializes the root `not-found`
 * boundary's rendered output into the RSC Flight payload (the
 * `self.__next_f.push(...)` script blob) embedded in EVERY page's initial
 * HTML, so the client router can render it instantly on a client-side
 * navigation error without a server round trip. The visible copy is
 * therefore present, verbatim, on every healthy page — not a signal at all.
 * The `<title>` tag is not duplicated into that payload (checked the same
 * way: grepped a real healthy page for "Page not found" and found zero
 * matches), so it stays a reliable, page-specific signal. A genuine 404 from
 * `notFound()` also already sets a real HTTP 404 status, which `classifyUrl`
 * catches before ever reaching this function — this only matters for the
 * hypothetical case of a page that fails to call `notFound()` and instead
 * renders wrong/empty content while still returning 200.
 */
const SOFT_404_TITLE = "<title>Page not found — Talentrah</title>";

/** True if a 200-status response body is actually this app's not-found page. */
export function looksLikeSoftNotFound(body: string): boolean {
  return body.includes(SOFT_404_TITLE);
}

export type LinkCheckResult =
  | { url: string; kind: "ok"; body: string }
  | { url: string; kind: "redirect-chain"; hops: string[]; finalStatus: number }
  | { url: string; kind: "broken"; status: number; chain?: string[] }
  | { url: string; kind: "soft-404" }
  | { url: string; kind: "too-many-redirects"; chain: string[] }
  | { url: string; kind: "error"; message: string };

/** The slice of the real `fetch` signature this module actually needs. */
export interface FetchLikeResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init?: { redirect?: "manual"; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<FetchLikeResponse>;

/**
 * Fetches `url` with `redirect: "manual"` and follows any redirect chain by
 * hand, up to `maxRedirects` hops, so a chain can be reported as its own
 * finding rather than collapsed into an opaque final result.
 *
 * - A chain that lands on a real 200 is `redirect-chain` (still worth
 *   knowing about — not necessarily broken, per this check's own scope).
 * - A chain (or a direct request) that lands on anything else is `broken`,
 *   carrying whatever hops preceded it so the report shows where it died.
 * - A 200 that is actually this app's own not-found page (see
 *   `looksLikeSoftNotFound`) is `soft-404`, distinct from a real 404 status.
 */
export async function classifyUrl(
  url: string,
  fetchImpl: FetchLike,
  opts: { maxRedirects?: number; timeoutMs?: number; userAgent?: string } = {},
): Promise<LinkCheckResult> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const headers = opts.userAgent ? { "user-agent": opts.userAgent } : undefined;
  const chain: string[] = [];
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: FetchLikeResponse;
    try {
      const controller = new AbortController();
      const timeout =
        opts.timeoutMs && opts.timeoutMs > 0
          ? setTimeout(() => controller.abort(), opts.timeoutMs)
          : undefined;
      try {
        res = await fetchImpl(current, { redirect: "manual", signal: controller.signal, headers });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch (err) {
      return { url, kind: "error", message: err instanceof Error ? err.message : String(err) };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return { url, kind: "broken", status: res.status, chain: [...chain, current] };
      }
      chain.push(current);
      current = new URL(location, current).toString();
      continue;
    }

    if (res.status !== 200) {
      return {
        url,
        kind: "broken",
        status: res.status,
        chain: chain.length ? [...chain, current] : undefined,
      };
    }

    if (chain.length > 0) {
      return { url, kind: "redirect-chain", hops: [...chain, current], finalStatus: 200 };
    }

    const body = await res.text();
    if (looksLikeSoftNotFound(body)) return { url, kind: "soft-404" };
    return { url, kind: "ok", body };
  }

  return { url, kind: "too-many-redirects", chain };
}

/* ────────────────────────────────────────────────────────────────────────────
 * send-477 — signed-out gated-link check. Additive: everything above this line
 * is send-384's and is unchanged. See e2e/signed-out-link-gate.spec.ts.
 * ────────────────────────────────────────────────────────────────────────── */

export type LinkRegion = "header" | "footer" | "main";

export interface RegionLink {
  region: LinkRegion;
  /** Absolute, rewritten onto the page's own origin, `#fragment` stripped. */
  url: string;
  pathname: string;
  /** Includes the leading `?`, or "". */
  search: string;
  text: string;
}

export function extractRegionLinks(
  html: string,
  pageUrl: string,
  opts: { internalOrigins?: string[] } = {},
): RegionLink[] {
  void html;
  void pageUrl;
  void opts;
  throw new Error("not implemented");
}

export function pageGroup(pathname: string): string {
  void pathname;
  throw new Error("not implemented");
}

export function loginRedirectKind(result: LinkCheckResult): "login" | "admin-login" | null {
  void result;
  throw new Error("not implemented");
}

/** `footer:* -> /jobs`, `main:/blog/* -> /tailor?coverLetter=1`. Chrome (header/footer) is keyed `*`: it repeats on every page. */
export function offenderKey(region: LinkRegion, group: string, target: string): string {
  return `${region}:${region === "main" ? group : "*"} -> ${target}`;
}

export interface CrawlSource {
  /** Path (and optional query) on the site being crawled. */
  path: string;
  /** Overrides `pageGroup(path)`, e.g. "404" for the not-found page. */
  group?: string;
}

export interface GatedLinkObservation {
  key: string;
  region: LinkRegion;
  group: string;
  /** pathname + search of the gated target. */
  target: string;
  texts: string[];
  sourcePaths: string[];
}

export interface CrawlTarget {
  url: string;
  pathname: string;
  search: string;
  login: "login" | "admin-login" | null;
  kind: LinkCheckResult["kind"];
}

export interface CrawlReport {
  sourcesFetched: number;
  sourceFailures: Array<{ path: string; problem: string }>;
  /** How many sources were crawled per page group — shows what a run actually covered. */
  groupCounts: Record<string, number>;
  /** Every distinct same-origin link target that was followed. */
  targets: CrawlTarget[];
  /** Only the targets that end at a login page. */
  observations: GatedLinkObservation[];
}

export async function crawlSignedOutLinks(opts: {
  baseUrl: string;
  sources: CrawlSource[];
  fetchImpl: FetchLike;
  internalOrigins?: string[];
  concurrency?: number;
  userAgent?: string;
  timeoutMs?: number;
}): Promise<CrawlReport> {
  void opts;
  throw new Error("not implemented");
}

