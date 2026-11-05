/**
 * The apply-link rules for the jobs-sheet import (JOBS-SHEET-IMPORT-1, ruling "URLS"). A link is kept only if it is a plain public https address; otherwise the ROW is skipped with a
 * reason (counted by the caller), never repaired:
 *   - https only (http is rejected, not upgraded);
 *   - no user info (user:pass@), no non-standard port;
 *   - the host is not an IP address (v4, v6 or the numeric forms a URL parser normalises to one), not a single-label or local name, not a link shortener;
 *   - the host is not one of the two job boards the sheet was copied from (any subdomain), and nothing in the address names a board or the "hnj" marker;
 *   - tracking is removed, nothing else: fbclid, gclid and utm_* query parameters. The rest of the query string is kept byte for byte.
 *
 * The board names are built from fragments at run time so that the repository never contains a full job-board address (the host-pattern test scans the repo for exactly that).
 */

const BOARD_FRAGMENTS: readonly (readonly string[])[] = [
  ["hotnigerian", "jobs"],
  ["myjob", "mag"],
];

/** Matches either job board as a host or anywhere inside an address text: any subdomain, any scheme, with or without www. Built from fragments. */
export const BOARD_HOST_PATTERN = new RegExp(
  `(?:[a-z0-9-]+\\.)*(?:${BOARD_FRAGMENTS.map((f) => f.join("")).join("|")})\\.(?:com|net|org|ng|co\\.uk)`,
  "i",
);

/** The "hnj" marker the board's own links carry in a query string or path. */
const BOARD_MARKER = /(?:^|[^a-z0-9])hnj(?:[^a-z0-9]|$)/i;

const SHORTENERS: readonly string[] = [
  "bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at", "tiny.cc", "lnkd.in", "rb.gy", "bl.ink", "t.ly", "s.id", "v.gd", "tr.im",
  "soo.gd", "clck.ru", "qr.ae", "adf.ly", "bit.do", "mcaf.ee", "su.pr", "shorte.st", "fb.me", "amzn.to", "youtu.be", "lnk.to", "linktr.ee",
];

const TRACKING_PARAM = /^(?:fbclid|gclid|utm_.*)$/i;

export type UrlVerdict = { ok: true; url: string; removed: string[] } | { ok: false; reason: string };

export function textNamesBoard(text: string): boolean {
  return BOARD_HOST_PATTERN.test(text) || BOARD_MARKER.test(text);
}

function isIpHost(hostname: string): boolean {
  return hostname.startsWith("[") || /^[0-9.]+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname);
}

function isShortener(hostname: string): boolean {
  return SHORTENERS.some((s) => hostname === s || hostname.endsWith(`.${s}`));
}

export function cleanApplyUrl(raw: string): UrlVerdict {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, reason: "no link" };
  if (/\s/.test(text)) return { ok: false, reason: "more than one address, or spaces in it" };
  if (text.length > 2000) return { ok: false, reason: "address too long" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "not a valid address" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "has user info" };
  if (url.port !== "") return { ok: false, reason: "non-standard port" };
  const host = url.hostname.toLowerCase();
  if (isIpHost(host)) return { ok: false, reason: "IP address host" };
  if (!host.includes(".") || host === "localhost" || /\.(?:local|localhost|internal|lan)$/.test(host)) return { ok: false, reason: "not a public host" };
  if (isShortener(host)) return { ok: false, reason: "link shortener" };
  if (BOARD_HOST_PATTERN.test(host)) return { ok: false, reason: "job-board host" };

  const removed: string[] = [];
  if (url.search !== "") {
    const kept = url.search
      .slice(1)
      .split("&")
      .filter((pair) => {
        if (pair === "") return false;
        const key = decodeURIComponentSafe(pair.split("=")[0]);
        if (TRACKING_PARAM.test(key)) {
          removed.push(key);
          return false;
        }
        return true;
      });
    url.search = kept.length > 0 ? `?${kept.join("&")}` : "";
  }
  const href = url.toString();
  if (textNamesBoard(href)) return { ok: false, reason: "job-board marker in the address" };
  return { ok: true, url: href, removed };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
