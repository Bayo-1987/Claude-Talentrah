import "server-only";

/**
 * robots.txt gate for "Import from URL" (send-136).
 *
 * WHY THIS EXISTS, AND WHY IT IS DELIBERATELY LIGHTER THAN sources.config.ts's
 * DILIGENCE. CLAUDE.md §6.12 documents a real, existing bar this project holds
 * itself to before fetching a third party's job listing markup: check
 * robots.txt, check Terms of Service, record the evidence
 * (sources.config.ts's header comment is hundreds of lines of exactly that,
 * per source, before a board is added to the aggregation pipeline). This
 * feature is a materially different situation, not the same one at smaller
 * scale — an employer pasting a URL for ONE fetch of a page THEY chose (their
 * own careers page, or a listing they wrote), reviewed and edited before
 * anything is saved, is closer to that employer opening the page in a
 * browser than to a scheduled crawler harvesting a board's entire inventory
 * for redistribution. There is no bulk crawl, no redistribution to other
 * users, and no standing config entry to research once and reuse forever —
 * every URL is a one-off, chosen by the person posting the job.
 *
 * That difference changes how much per-URL diligence is proportionate (a
 * live ToS reading for every arbitrary URL an employer might paste is not
 * practical the way it is for a fixed, small source list), but it does not
 * remove the robots.txt check itself — robots.txt is the mechanism a site
 * uses to say "don't fetch this programmatically" regardless of who is
 * asking or why, and a single opt-in fetch is still a fetch. This checks the
 * TARGET PATH against the origin's `User-agent: *` group (the same
 * catch-all directive a plain, unidentified HTTP client is bound by) and
 * refuses the fetch if that group disallows it — see fetch-page.ts for what
 * happens next (a clean fallback to the blank form, never a crash or a
 * silent skip of the check).
 *
 * Deliberately does NOT look for a Talentrah-specific or AI-crawler-specific
 * user-agent group (the way hotnigerianjobs.com's `ClaudeBot`/`GPTBot`/`CCBot`
 * block or Workable's `Content-Signal: ai-train=no` do) — this fetch doesn't
 * identify as one of those, and doesn't need to: it isn't training a model or
 * building a redistributable corpus, it's reading one page once on behalf of
 * the person who is about to publish a listing they themselves wrote. The
 * `User-agent: *` group is the right one to honour because it's the one that
 * binds any generic, unidentified fetch — which is what this literally is.
 *
 * FAILS OPEN ONLY WHEN robots.txt ITSELF CANNOT BE READ (missing, non-200,
 * or a network error) — no robots.txt is not a refusal, and the standard
 * default (both for browsers and for well-behaved crawlers) is "nothing was
 * declared, so nothing is restricted". It FAILS CLOSED — the whole point —
 * once a robots.txt is actually readable and its `*` group disallows the
 * path.
 */

const ROBOTS_FETCH_TIMEOUT_MS = 5000;

interface RobotsRule {
  path: string;
  allow: boolean;
}

/**
 * Minimal robots.txt parser, scoped to what this feature needs: `User-agent`
 * group boundaries and that group's `Allow`/`Disallow` rules. Not a
 * general-purpose robots.txt library — no `Sitemap`/`Crawl-delay` handling,
 * no wildcard user-agent precedence beyond an exact `*` match — because the
 * only question this ever answers is "does the `*` group disallow this one
 * path".
 */
function parseWildcardGroupRules(robotsTxt: string): RobotsRule[] {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let sawRuleSinceLastAgentLine = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      // A fresh User-agent line that follows RULES (not just more agent
      // lines) starts a new group — this is what lets consecutive
      // "User-agent: a" / "User-agent: b" lines share one rule set while a
      // later, separate group does not merge into it.
      if (!current || sawRuleSinceLastAgentLine) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleSinceLastAgentLine = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === "disallow" || key === "allow") && current) {
      sawRuleSinceLastAgentLine = true;
      // An empty Disallow value is robots.txt's way of saying "nothing is
      // disallowed" — represented as an Allow of "/" (everything) rather than
      // a Disallow rule with nothing to match, so it can win against a more
      // specific Disallow only if it is genuinely more specific (it isn't,
      // so in practice it just contributes no restriction).
      if (key === "disallow" && !value) {
        current.rules.push({ path: "/", allow: true });
      } else {
        current.rules.push({ path: value, allow: key === "allow" });
      }
    }
  }

  const wildcardRules: RobotsRule[] = [];
  for (const group of groups) {
    if (group.agents.includes("*")) wildcardRules.push(...group.rules);
  }
  return wildcardRules;
}

/**
 * Standard robots.txt path matching: `*` is the only wildcard the spec
 * defines, and a trailing `$` anchors the end; anything else — a literal
 * `?`, `.`, `+`, etc. — matches itself and nothing else.
 *
 * `?` MUST be escaped before `*` is turned into `.*`, not left for the
 * generic special-char class to skip: real robots.txt in the wild uses `?`
 * literally to mean "a query string starts here" (e.g.
 * `jobs.workable.com/robots.txt`'s own `Disallow: /search*?*`, verified live
 * — CLAUDE.md/sources.config.ts already document this origin's pagination
 * rule). Leaving `?` unescaped turns it into a regex quantifier instead: the
 * pattern above would compile to `/search.*?.*`, where `.*?` is a LAZY
 * wildcard, not "literal question mark" — and a lazy `.*?` still matches
 * anything, so the rule ends up blocking the entire `/search/*` tree
 * `Allow: /search/*` was supposed to permit. Caught by re-testing this
 * module against jobs.workable.com's real, live robots.txt rather than only
 * a synthetic fixture — the exact "prove it against reality, not just a
 * hand-written test" habit CLAUDE.md asks for.
 */
function matchesRule(path: string, pattern: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
}

/**
 * True if the `*` group's rules disallow `path`. Per the standard
 * (RFC 9309): the LONGEST matching rule wins; an exact-length tie favours
 * Allow.
 */
export function isPathDisallowed(robotsTxt: string, path: string): boolean {
  const rules = parseWildcardGroupRules(robotsTxt);
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!matchesRule(path, rule.path)) continue;
    if (!best || rule.path.length > best.path.length) {
      best = rule;
    } else if (rule.path.length === best.path.length && rule.allow) {
      best = rule;
    }
  }
  return best !== null && !best.allow;
}

/**
 * Fetches `<origin>/robots.txt` and checks whether it permits fetching
 * `url`'s path under the `*` group. See the module header for the fail-open
 * (no robots.txt) vs fail-closed (`*` group disallows) split.
 */
export async function isUrlAllowedByRobots(url: URL): Promise<boolean> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const res = await fetch(robotsUrl.toString(), {
      signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "TalentrahJobImportBot/1.0 (+employer-initiated, single-page fetch)" },
    });
    // No robots.txt (404, or any non-2xx) is not a refusal — see header.
    if (!res.ok) return true;
    const body = await res.text();
    return !isPathDisallowed(body, url.pathname + url.search);
  } catch {
    // Unreachable robots.txt (DNS/timeout/network error) fails open for the
    // same reason a 404 does — see header. A transient robots.txt outage
    // should not be indistinguishable from "this site refuses automated
    // access", and the actual page fetch right after this has its own
    // failure handling if the site itself is down.
    return true;
  }
}
