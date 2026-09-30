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
 *
 * WHY THIS IS NOT JUST `extractLinks` + `classifyUrl` AS-IS:
 *  - `extractLinks` forgets WHICH page a link was on and which part of the page
 *    (masthead, main content, footer). An allowlist keyed by target alone would
 *    let a second page start linking to an already-listed target unnoticed.
 *  - its `<a\s[^>]*href=` pattern stops at the first `>`, and a Tailwind class
 *    such as `[&>svg]:h-4` contains one, so an anchor whose class precedes its
 *    href would be silently missed. Attributes are parsed quote-aware here.
 *  - `classifyUrl` reports a redirect to /login as a benign "redirect-chain";
 *    for this check that redirect IS the failure, so it is read off the hops.
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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function elementRanges(html: string, tag: "header" | "footer"): Array<[number, number]> {
  return [...html.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"))].map(
    (m) => [m.index!, m.index! + m[0].length] as [number, number],
  );
}

/**
 * Same-origin `<a href>` links with the page region each sits in: `header` (the
 * masthead), `footer`, or `main` (everything else). `internalOrigins` are extra
 * origins to count as this site — the production canonical origin, which
 * `absoluteUrl()` writes into some hrefs and which is NOT the origin of a CI
 * server on localhost — and are rewritten onto the page's own origin.
 */
export function extractRegionLinks(
  html: string,
  pageUrl: string,
  opts: { internalOrigins?: string[] } = {},
): RegionLink[] {
  const pageOrigin = new URL(pageUrl).origin;
  const internal = new Set([pageOrigin, ...(opts.internalOrigins ?? []).map((o) => new URL(o).origin)]);
  const footers = elementRanges(html, "footer");
  const headers = elementRanges(html, "header");
  const within = (ranges: Array<[number, number]>, at: number) => ranges.some(([a, b]) => at >= a && at < b);

  const seen = new Set<string>();
  const out: RegionLink[] = [];
  // Attributes are matched as quoted strings or non-`>` characters, so a `>` inside a quoted
  // attribute (a Tailwind class, a title) does not end the tag early.
  for (const m of html.matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (!hrefMatch) continue;
    const href = decodeEntities((hrefMatch[1] ?? hrefMatch[2] ?? "").trim());
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !internal.has(u.origin)) continue;

    const region: LinkRegion = within(footers, m.index!) ? "footer" : within(headers, m.index!) ? "header" : "main";
    const url = new URL(u.pathname + u.search, pageOrigin).toString();
    const key = `${region}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      region,
      url,
      pathname: u.pathname,
      search: u.search,
      text: decodeEntities(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/**
 * The "kind of page" a link was found on: `/` for the homepage, the exact path
 * for a top-level page (`/about`), and `/<section>/*` for anything deeper
 * (`/blog/*`, `/jobs/*`). Deliberately coarse — `/jobs/remote` shares a group
 * with `/jobs/<id>` — so the allowlist stays a few dozen rows rather than one
 * per detail page. The cost: a second page of an already-listed kind that starts
 * linking to an already-listed target is not caught by the crawl.
 */
export function pageGroup(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  if (segments.length === 1) return `/${segments[0]}`;
  return `/${segments[0]}/*`;
}

const LOGIN_PATHS: Record<string, "login" | "admin-login"> = {
  "/login": "login",
  "/admin/login": "admin-login",
};

/**
 * Whether following a link led through a login page. Every hop AFTER the first is
 * checked, so `/a -> /b -> /login -> /welcome` is caught just as `/tracker -> /login`
 * is; the first hop is what the link asked for, so a link that points AT /login is
 * not a redirect to it. `/admin/login` is reported separately: the admin area has its
 * own gate (proxy.ts `adminGate`) and is not part of `isProtectedSeekerPath`.
 */
export function loginRedirectKind(result: LinkCheckResult): "login" | "admin-login" | null {
  const hops =
    result.kind === "redirect-chain" ? result.hops : result.kind === "broken" || result.kind === "too-many-redirects" ? (result.chain ?? []) : [];
  for (const hop of hops.slice(1)) {
    try {
      const kind = LOGIN_PATHS[new URL(hop).pathname.replace(/\/$/, "")];
      if (kind) return kind;
    } catch {
      // A hop that is not a URL cannot be a login page.
    }
  }
  return null;
}

/** `footer:* -> /jobs`, `main:/blog/* -> /tailor?coverLetter=1`. Chrome (header/footer) is keyed `*`: it repeats on every page. */
export function offenderKey(region: LinkRegion, group: string, target: string): string {
  return `${region}:${region === "main" ? group : "*"} -> ${target}`;
}

export interface CrawlSource {
  /** Path (and optional query) on the site being crawled. */
  path: string;
  /** Overrides `pageGroup(path)`, e.g. "404" for the not-found page. A source with a group may answer 404. */
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
  /** Sources crawled per page group — shows what a run actually covered. */
  groupCounts: Record<string, number>;
  /** Every distinct same-origin link target that was followed. */
  targets: CrawlTarget[];
  /** Only the targets that end at a login page. */
  observations: GatedLinkObservation[];
}

async function mapConcurrently<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Signed-out crawl: fetch every source once (no cookies, no redirects followed),
 * collect its same-origin links by region, follow every DISTINCT target once hop by
 * hop, and report which targets end at a login page and where they were linked from.
 * A source must answer 200 — unless it was given a `group`, which marks it as a
 * deliberate seed (the not-found page) and lets it answer 404. Anything else is
 * reported in `sourceFailures`, never skipped silently.
 */
export async function crawlSignedOutLinks(opts: {
  baseUrl: string;
  sources: CrawlSource[];
  fetchImpl: FetchLike;
  internalOrigins?: string[];
  concurrency?: number;
  userAgent?: string;
  timeoutMs?: number;
}): Promise<CrawlReport> {
  const origin = new URL(opts.baseUrl).origin;
  const concurrency = opts.concurrency ?? 6;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const userAgent = opts.userAgent ?? "TalentrahLinkGate/1.0";
  const headers = { "user-agent": userAgent };

  const fetched = await mapConcurrently(opts.sources, concurrency, async (source) => {
    const url = new URL(source.path, origin).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await opts.fetchImpl(url, { redirect: "manual", signal: controller.signal, headers });
      const acceptable = res.status === 200 || (res.status === 404 && source.group !== undefined);
      if (!acceptable) return { source, url, problem: `HTTP ${res.status}` } as const;
      return { source, url, body: await res.text() } as const;
    } catch (err) {
      return { source, url, problem: `error: ${err instanceof Error ? err.message : String(err)}` } as const;
    } finally {
      clearTimeout(timer);
    }
  });

  const sourceFailures: CrawlReport["sourceFailures"] = [];
  const groupCounts: Record<string, number> = {};
  const edges = new Map<
    string,
    { region: LinkRegion; group: string; target: string; url: string; texts: Set<string>; sources: Set<string> }
  >();
  let sourcesFetched = 0;

  for (const f of fetched) {
    if ("problem" in f) {
      sourceFailures.push({ path: f.source.path, problem: f.problem ?? "" });
      continue;
    }
    sourcesFetched += 1;
    const group = f.source.group ?? pageGroup(new URL(f.url).pathname);
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
    for (const link of extractRegionLinks(f.body, f.url, { internalOrigins: opts.internalOrigins })) {
      const target = link.pathname + link.search;
      const key = offenderKey(link.region, group, target);
      let edge = edges.get(key);
      if (!edge) {
        edge = { region: link.region, group: link.region === "main" ? group : "*", target, url: link.url, texts: new Set(), sources: new Set() };
        edges.set(key, edge);
      }
      if (link.text) edge.texts.add(link.text);
      edge.sources.add(f.source.path);
    }
  }

  const distinctUrls = [...new Set([...edges.values()].map((e) => e.url))].sort();
  const followed = await mapConcurrently(distinctUrls, concurrency, async (url) => {
    const result = await classifyUrl(url, opts.fetchImpl, { timeoutMs, userAgent });
    const u = new URL(url);
    const target: CrawlTarget = { url, pathname: u.pathname, search: u.search, login: loginRedirectKind(result), kind: result.kind };
    return target;
  });
  const byUrl = new Map(followed.map((t) => [t.url, t]));

  const observations: GatedLinkObservation[] = [...edges.entries()]
    .filter(([, e]) => byUrl.get(e.url)?.login)
    .map(([key, e]) => ({
      key,
      region: e.region,
      group: e.group,
      target: e.target,
      texts: [...e.texts].sort(),
      sourcePaths: [...e.sources].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { sourcesFetched, sourceFailures, groupCounts, targets: followed, observations };
}
