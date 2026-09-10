import "server-only";
import { decodeHtmlEntities } from "@/lib/jobs/extract-jd";
import { isUrlAllowedByRobots } from "./robots";

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Hard ceiling on the RAW HTML this will even attempt to process, before any
 * LLM involvement at all — a separate, much larger bound than
 * token-budget.ts's MAX_PAGE_TEXT_CHARS (which trims the already-cleaned
 * text down to what the model may see). This one exists so a pathological
 * multi-megabyte page can't make the regex-based cleaning pass itself slow
 * or memory-heavy; it is a request-shape guard, not a model-cost guard.
 */
const MAX_RAW_HTML_CHARS = 2_000_000;

export type FetchJobPageResult =
  | { ok: true; url: string; html: string; text: string }
  | { ok: false; reason: string };

function normalizeUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    // A bare "example.com/careers/123" (no scheme) is a realistic paste —
    // default to https rather than rejecting it outright.
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Strips markup down to visible-ish text: scripts, styles, comments and the
 * three boilerplate landmark tags (header/nav/footer) are dropped entirely
 * rather than flattened to space-separated noise, since a careers page's
 * global nav and footer links are exactly the content that would otherwise
 * compete with the actual job listing for the model's bounded attention
 * budget. Block-level tags become newlines so paragraph/list structure
 * survives as something a model (or a human skimming the review step) can
 * still read, the same shape src/lib/jobs/extract-jd.ts's stripHtml uses for
 * a JD's own HTML.
 */
export function htmlToPlainText(html: string): string {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(header|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const withLineBreaks = withoutNoise
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n");

  const textOnly = withLineBreaks.replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(textOnly)
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fetches a URL an employer pasted, server-side only (never call this from a
 * client component — see job-import/action.ts, the one caller). Gated by
 * robots.txt (robots.ts) before the real request goes out. Returns a
 * discriminated result rather than throwing: every failure mode here (bad
 * URL, robots disallow, non-200, non-HTML, network error) is a real,
 * expected outcome this feature has to degrade cleanly from — see
 * action.ts and CLAUDE.md's requirement that a blocked/failed fetch falls
 * back to the blank form, not a crash.
 */
export async function fetchJobPage(rawUrl: string): Promise<FetchJobPageResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, reason: "That doesn't look like a valid web address." };

  const allowed = await isUrlAllowedByRobots(url);
  if (!allowed) {
    return {
      ok: false,
      reason: "That site's robots.txt doesn't allow this page to be fetched automatically.",
    };
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Identifies this as what it is — an employer-initiated import, not
        // an anonymous scraper or a named AI crawler — see robots.ts's
        // header for why the *general* `*` robots group is still the one
        // that governs this regardless of the UA string.
        "User-Agent":
          "Mozilla/5.0 (compatible; TalentrahJobImportBot/1.0; +employer-initiated job import)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch {
    return { ok: false, reason: "Couldn't reach that page — check the URL and try again." };
  }

  if (!response.ok) {
    return { ok: false, reason: `That page returned an error (HTTP ${response.status}).` };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("html") && !contentType.includes("text")) {
    return { ok: false, reason: "That URL didn't return a readable web page." };
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return { ok: false, reason: "Couldn't read that page's content." };
  }

  html = html.slice(0, MAX_RAW_HTML_CHARS);
  const text = htmlToPlainText(html);
  if (!text) {
    return { ok: false, reason: "That page didn't have any readable text to import." };
  }

  return { ok: true, url: response.url || url.toString(), html, text };
}
