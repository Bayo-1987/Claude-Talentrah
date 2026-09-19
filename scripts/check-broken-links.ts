/**
 * Broken-link check — send-384.
 *
 * Nothing like this existed before (checked: no link-checker, no Lighthouse
 * CI config, nothing under scripts/ or .github/workflows/ that fetches a
 * page and inspects its links — grepped for "link.?check", "broken.?link"
 * and "lighthouse" across the repo before writing this). The audit that
 * asked for this marked link health "Not checked" — a genuine gap, not a
 * known failure, so this can turn up zero, some, or several broken links.
 *
 * ── WHAT THIS CHECKS, AND WHY IN TWO PASSES ───────────────────────────────
 *
 * Pass 1: every URL `src/app/sitemap.ts` actually emits, pulled from the
 * real, live `/sitemap.xml` rather than re-implemented — that file's own
 * header already states its rule ("only URLs a signed-out visitor actually
 * receives a 200 for"), so the sitemap IS the canonical list of internal
 * pages this site claims are live. `absoluteUrl()` (lib/seo/site.ts) means
 * every entry is already an absolute `https://www.talentrah.com/...` URL
 * regardless of where `/sitemap.xml` itself was fetched from, so pointing
 * `LINK_CHECK_SITEMAP_URL` at a preview deploy still checks THAT deploy's
 * declared URLs, but always against the production origin those URLs
 * actually point at (no env var here changes that; see site.ts).
 *
 * Pass 2: same-origin AND external links found by fetching every sitemap
 * page that actually returned 200, one level deep, deduplicated (the
 * masthead/footer alone repeats the same ~15 links on every one of 453+
 * pages, so re-checking those per-page would be almost all wasted work).
 *
 * ── INTERNAL vs EXTERNAL SCOPE (this ticket's own open question, decided) ─
 *
 * Internal (same-origin) links are checked the same way as the sitemap
 * itself and are what this script's exit code reflects — a broken internal
 * link is this site's own bug. External links (apply URLs, scholarship
 * provider pages) are reported but never fail the run: they're third-party
 * infrastructure this project doesn't control, a slow or temporarily-down
 * ATS is routine, and a check that fails on someone else's flakiness would
 * get ignored or disabled within a week. External requests get a shorter
 * timeout for the same reason — no reason to wait as long for a site that
 * isn't this one's problem to fix.
 *
 * ── WHY THIS IS A SCRIPT, NOT A PER-PR CI JOB ──────────────────────────────
 *
 * This makes a real network request per URL — 453+ sitemap entries plus
 * however many unique internal/external links a one-level crawl turns up —
 * against the live production site. That's the wrong thing to run on every
 * push (CLAUDE.md's own CI section is exactly about not adding load a PR
 * didn't ask for), and a third-party site's temporary 500 has nothing to do
 * with whether a given PR is safe to merge. This is meant to be run by hand
 * or on a schedule (e.g. a weekly GitHub Actions cron, not wired up here —
 * that's a deliberate follow-up, not this ticket's ask), not as a merge gate.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────
 *
 *   npm run check-broken-links
 *
 * Env overrides:
 *   LINK_CHECK_SITEMAP_URL   default https://www.talentrah.com/sitemap.xml
 *   LINK_CHECK_CONCURRENCY   default 6 — concurrent in-flight requests
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { classifyUrl, extractLinks, parseSitemapUrls, type LinkCheckResult } from "./link-check";

const SITEMAP_URL = process.env.LINK_CHECK_SITEMAP_URL ?? "https://www.talentrah.com/sitemap.xml";
const CONCURRENCY = Math.max(1, Number(process.env.LINK_CHECK_CONCURRENCY ?? 6));
const INTERNAL_TIMEOUT_MS = 12_000;
const EXTERNAL_TIMEOUT_MS = 6_000;
const USER_AGENT = "TalentrahLinkChecker/1.0 (+https://www.talentrah.com)";

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function describe(result: LinkCheckResult): string {
  switch (result.kind) {
    case "ok":
      return "OK";
    case "soft-404":
      return "SOFT 404 — 200 status, but the page is this app's own not-found page";
    case "redirect-chain":
      return `REDIRECT CHAIN (${result.hops.length - 1} hop${result.hops.length - 1 === 1 ? "" : "s"}) -> 200: ${result.hops.join(" -> ")}`;
    case "too-many-redirects":
      return `TOO MANY REDIRECTS: ${result.chain.join(" -> ")}`;
    case "broken":
      return result.chain
        ? `BROKEN (HTTP ${result.status}) via redirect: ${result.chain.join(" -> ")}`
        : `BROKEN (HTTP ${result.status})`;
    case "error":
      return `ERROR: ${result.message}`;
  }
}

/** Only these count as this script's own failure — see the header above. */
function isInternalFailure(result: LinkCheckResult): boolean {
  return result.kind === "broken" || result.kind === "soft-404" || result.kind === "too-many-redirects" || result.kind === "error";
}

async function main() {
  console.log(`Fetching sitemap: ${SITEMAP_URL}`);
  const sitemapRes = await fetch(SITEMAP_URL, { headers: { "user-agent": USER_AGENT } });
  if (!sitemapRes.ok) {
    console.error(`Could not fetch the sitemap: HTTP ${sitemapRes.status}`);
    process.exit(1);
  }
  const sitemapUrls = parseSitemapUrls(await sitemapRes.text());
  if (sitemapUrls.length === 0) {
    console.error("Sitemap parsed to zero URLs — treating as a failure to fetch, not a site with no pages.");
    process.exit(1);
  }
  console.log(`${sitemapUrls.length} URLs in the sitemap.\n`);

  console.log(`Checking sitemap URLs (concurrency ${CONCURRENCY})...`);
  const sitemapResults = await mapWithConcurrency(sitemapUrls, CONCURRENCY, (url) =>
    classifyUrl(url, fetch, { timeoutMs: INTERNAL_TIMEOUT_MS, userAgent: USER_AGENT }),
  );

  const alreadyChecked = new Set(sitemapUrls);
  const internalToCrawl = new Set<string>();
  const externalToCrawl = new Set<string>();
  for (const result of sitemapResults) {
    if (result.kind !== "ok") continue;
    const { internal, external } = extractLinks(result.body, result.url);
    for (const u of internal) if (!alreadyChecked.has(u)) internalToCrawl.add(u);
    for (const u of external) externalToCrawl.add(u);
  }

  console.log(
    `\nCrawling one level deep: ${internalToCrawl.size} unique internal link(s), ` +
      `${externalToCrawl.size} unique external link(s).`,
  );

  const crawledInternal = await mapWithConcurrency([...internalToCrawl], CONCURRENCY, (url) =>
    classifyUrl(url, fetch, { timeoutMs: INTERNAL_TIMEOUT_MS, userAgent: USER_AGENT }),
  );
  const crawledExternal = await mapWithConcurrency([...externalToCrawl], CONCURRENCY, (url) =>
    classifyUrl(url, fetch, { timeoutMs: EXTERNAL_TIMEOUT_MS, userAgent: USER_AGENT }),
  );

  const allInternal = [
    ...sitemapUrls.map((url, i) => ({ url, result: sitemapResults[i] })),
    ...[...internalToCrawl].map((url, i) => ({ url, result: crawledInternal[i] })),
  ];
  const allExternal = [...externalToCrawl].map((url, i) => ({ url, result: crawledExternal[i] }));

  const brokenInternal = allInternal.filter((r) => isInternalFailure(r.result));
  const internalRedirects = allInternal.filter(
    (r) => r.result.kind === "redirect-chain",
  );
  const externalIssues = allExternal.filter((r) => isInternalFailure(r.result));

  console.log("\n" + "=".repeat(72));
  console.log("INTERNAL — sitemap + one level of same-origin links");
  console.log("=".repeat(72));
  if (brokenInternal.length === 0) {
    console.log(`All ${allInternal.length} internal URLs OK (or a benign redirect chain).`);
  } else {
    for (const { url, result } of brokenInternal) console.log(`${url}\n  ${describe(result)}`);
  }
  if (internalRedirects.length > 0) {
    console.log(`\n${internalRedirects.length} internal URL(s) resolve via a redirect chain (not failures, still listed):`);
    for (const { url, result } of internalRedirects) console.log(`${url}\n  ${describe(result)}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log("EXTERNAL — best-effort, never fails this run (see this file's own header)");
  console.log("=".repeat(72));
  if (externalIssues.length === 0) {
    console.log(`All ${allExternal.length} external URLs OK (within a ${EXTERNAL_TIMEOUT_MS / 1000}s timeout).`);
  } else {
    for (const { url, result } of externalIssues) console.log(`${url}\n  ${describe(result)}`);
  }

  console.log("\n" + "=".repeat(72));
  console.log(
    `SUMMARY: ${allInternal.length} internal URLs checked, ${brokenInternal.length} broken. ` +
      `${allExternal.length} external URLs checked, ${externalIssues.length} reported (non-blocking).`,
  );

  if (brokenInternal.length > 0) {
    process.exitCode = 1;
  }
}

void main();
