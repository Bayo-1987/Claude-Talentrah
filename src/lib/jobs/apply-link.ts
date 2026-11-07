import { cleanApplyUrl } from "@/lib/jobs/sheet-import/url";

/**
 * The ONE validator for an employer's career-site link ("On our career site", PR-E4). It never repairs: a link is accepted as it is or refused with a reason and a sentence that says how to fix it.
 *
 * It imports the sheet importer's rules instead of copying them (src/lib/jobs/sheet-import/url.ts): https only; no user info, port, IP, single-label or local host, link shortener or job-board host.
 * The only change it makes is the one the importer makes: tracking parameters removed, and the host folded to lower case by the URL parser.
 * On top of those it adds, for this feature only: the original host text must be ASCII (the URL parser would otherwise turn an IDN into xn-- silently), no label may start with xn--, no trailing dot,
 * no whitespace or control characters, at most 2000 characters (the importer's cap, and the database CHECK's).
 *
 * TWO WAYS IN. Path A: the host is the verified company's domain, or a subdomain of it on a dot boundary ("careers.acme.com" for "acme.com"; never "evilacme.com" or "acme.com.evil.com"). The caller passes
 * the domain ONLY for a verified company; an unverified company (null) has Path B alone. Path B: an applicant-tracking host from the allowlist below. Exact hosts keep the company in the PATH, so
 * they need a first path segment; tenant hosts keep it in the subdomain, so they need exactly one tenant label that is not one of the vendor's own labels (www, app, login...).
 *
 * The database function set_job_apply_link (0277) re-checks the same rules in SQL, because only the Server Action can call it but a bug here must not be able to store a bad address.
 * tests/jobs/apply-link.test.ts replays the SQL's rules from the text of the migration and requires the two to agree in both directions on the whole table, and the constants below to equal the SQL's.
 */

/** Applicant-tracking hosts that keep the company in the path. Mirrors the SQL (0277). */
export const ATS_EXACT_HOSTS: readonly string[] = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "apply.workable.com",
  "jobs.ashbyhq.com",
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
];
/** Applicant-tracking domains that keep the company in a ONE-label subdomain ("acme.bamboohr.com"). Mirrors the SQL. */
export const ATS_TENANT_SUFFIXES: readonly string[] = ["bamboohr.com", "recruitee.com", "teamtailor.com"];
/** Labels a vendor uses for itself, never a tenant. Mirrors the SQL (G1b-1). */
export const ATS_VENDOR_LABELS: readonly string[] = ["www", "app", "api", "login", "accounts", "support", "help", "blog", "status", "docs"];
/** The importer's cap, the database CHECK's, and the SQL function's. */
export const APPLY_LINK_MAX_LENGTH = 2000;

export type ApplyLinkReason =
  | "empty"
  | "whitespace"
  | "control_character"
  | "too_long"
  | "not_a_link"
  | "not_https"
  | "user_info"
  | "port"
  | "ip_host"
  | "not_public_host"
  | "shortener"
  | "job_board"
  | "non_ascii_host"
  | "xn_label"
  | "trailing_dot"
  | "host_not_allowed"
  | "ats_needs_path"
  | "ats_vendor_label";

export type ApplyLinkVerdict =
  | { ok: true; kind: "company" | "ats"; url: string; host: string; warning: "name_mismatch" | undefined }
  | { ok: false; reason: ApplyLinkReason; message: string };

const MESSAGES: Record<Exclude<ApplyLinkReason, "host_not_allowed">, string> = {
  empty: "Enter the address of your careers page, for example https://careers.yourcompany.com/jobs.",
  whitespace: "That address has a space in it. Paste one full address with no spaces.",
  control_character: "That address has a character that can't be used. Copy it again from your browser's address bar.",
  too_long: "That address is longer than 2,000 characters. Use a shorter link to your careers page.",
  not_a_link: "That doesn't look like a web address. Start it with https://, for example https://careers.yourcompany.com/jobs.",
  not_https: "The address must start with https:// (a secure link). Use the https:// version of your careers page.",
  user_info: "Remove the name and password from the address (the part before the @). Use the plain careers page address.",
  port: "Remove the port number (the :8080 part) from the address. Use the plain careers page address.",
  ip_host: "Use your company's web address (like careers.yourcompany.com), not a number address.",
  not_public_host: "That address isn't a public website. Use the address anyone on the internet can open.",
  shortener: "Short links (like bit.ly) can't be used. Paste the full address of your careers page.",
  job_board: "Links to job boards can't be used here. Use your own careers page or your applicant tracking page.",
  non_ascii_host: "The website name has letters that can't be checked. Use the plain-letters version of the address.",
  xn_label: "The website name uses an encoded form (xn--) that can't be used. Use your company's ordinary web address.",
  trailing_dot: "Remove the dot at the end of the website name.",
  ats_needs_path: "Add your company's page to the address, for example https://boards.greenhouse.io/yourcompany. The bare site address can't be used.",
  ats_vendor_label: "That is the applicant tracking system's own page, not yours. Use your company's address, such as yourcompany.bamboohr.com.",
};

/** The sentence for a refusal. `companyVerified` only changes the "host not allowed" wording: an unverified company is told why its own website is not available. */
export function applyLinkReasonMessage(reason: ApplyLinkReason, companyVerified: boolean): string {
  if (reason !== "host_not_allowed") return MESSAGES[reason];
  return companyVerified
    ? "That address isn't on your company's website or on a supported applicant tracking system (Greenhouse, Lever, Workable, Ashby, SmartRecruiters, BambooHR, Recruitee or Teamtailor). Use a page on your own website, or your applicant tracking page."
    : "Your company isn't verified yet, so only an applicant tracking page can be used (Greenhouse, Lever, Workable, Ashby, SmartRecruiters, BambooHR, Recruitee or Teamtailor). Verify your company to use your own website.";
}

const CLEAN_REASONS: Record<string, ApplyLinkReason> = {
  "no link": "empty",
  "more than one address, or spaces in it": "whitespace",
  "address too long": "too_long",
  "not a valid address": "not_a_link",
  "not https": "not_https",
  "has user info": "user_info",
  "non-standard port": "port",
  "IP address host": "ip_host",
  "not a public host": "not_public_host",
  "link shortener": "shortener",
  "job-board host": "job_board",
  "job-board marker in the address": "job_board",
};

function refuse(reason: ApplyLinkReason, companyVerified: boolean): ApplyLinkVerdict {
  return { ok: false, reason, message: applyLinkReasonMessage(reason, companyVerified) };
}

const STOP_WORDS = new Set(["ltd", "limited", "plc", "inc", "llc", "nigeria", "company", "group", "services", "the", "and"]);
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A warning, never a block: the company slug in an applicant-tracking address resembles none of the words of the company's name. */
function nameMismatch(slug: string, companyName: string | null | undefined): boolean {
  if (!companyName) return false;
  const slugN = alnum(slug);
  if (slugN.length < 3) return false;
  const tokens = companyName.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  if (tokens.length === 0) return false;
  const nameN = alnum(companyName);
  return !(tokens.some((t) => slugN.includes(t)) || nameN.includes(slugN));
}

/**
 * Judges a career-site address. `companyDomain` is the verified company's domain, or null when the company is unverified (or has no domain): then only Path B is open.
 * Returns the cleaned address (the one to store), its host, which path let it in, and an optional name-mismatch warning.
 */
export function checkApplyLink(raw: unknown, companyDomain: string | null, options: { companyName?: string | null } = {}): ApplyLinkVerdict {
  const domain = (companyDomain ?? "").trim().toLowerCase();
  const verified = domain !== "";
  if (typeof raw !== "string") return refuse("empty", verified);
  const text = raw.trim();
  if (text === "") return refuse("empty", verified);
  if (/\s/.test(text)) return refuse("whitespace", verified);
  if (/[\u0000-\u001f\u007f]/.test(text)) return refuse("control_character", verified);
  if (text.length > APPLY_LINK_MAX_LENGTH) return refuse("too_long", verified);

  // The host as WRITTEN, before the parser can rewrite it (it turns an IDN into xn-- and drops a default port).
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(text)?.[1];
  if (authority === undefined) return refuse("not_a_link", verified);
  if (authority.includes("@")) return refuse("user_info", verified);
  const writtenHost = authority.replace(/:\d*$/, "");
  if (/[^\u0000-\u007f]/.test(writtenHost)) return refuse("non_ascii_host", verified);
  if (/(^|\.)xn--/i.test(writtenHost)) return refuse("xn_label", verified);
  if (writtenHost.endsWith(".")) return refuse("trailing_dot", verified);

  const cleaned = cleanApplyUrl(text);
  if (!cleaned.ok) return refuse(CLEAN_REASONS[cleaned.reason] ?? "not_a_link", verified);
  const parsed = new URL(cleaned.url);
  const host = parsed.hostname;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes("..")) return refuse("non_ascii_host", verified);
  if (/(^|\.)xn--/.test(host)) return refuse("xn_label", verified);

  // Path A: the verified company's own domain, on a dot boundary.
  if (verified && (host === domain || host.endsWith(`.${domain}`))) {
    return { ok: true, kind: "company", url: cleaned.url, host, warning: undefined };
  }

  // Path B: an applicant-tracking host.
  if (ATS_EXACT_HOSTS.includes(host)) {
    if (!/^\/[^/]+/.test(parsed.pathname)) return refuse("ats_needs_path", verified);
    const slug = decodeSegment(parsed.pathname.split("/")[1] ?? "");
    return { ok: true, kind: "ats", url: cleaned.url, host, warning: nameMismatch(slug, options.companyName) ? "name_mismatch" : undefined };
  }
  for (const suffix of ATS_TENANT_SUFFIXES) {
    if (!host.endsWith(`.${suffix}`)) continue;
    const label = host.slice(0, -(suffix.length + 1));
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return refuse("host_not_allowed", verified);
    if (ATS_VENDOR_LABELS.includes(label)) return refuse("ats_vendor_label", verified);
    return { ok: true, kind: "ats", url: cleaned.url, host, warning: nameMismatch(label, options.companyName) ? "name_mismatch" : undefined };
  }
  return refuse("host_not_allowed", verified);
}

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
