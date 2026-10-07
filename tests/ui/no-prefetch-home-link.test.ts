/**
 * Payload quick win (owner, 7 Oct 2026): a link to the home route must not be prefetched.
 *
 * Measured on production, signed out, cold: the router prefetches every in-viewport <Link>, and the prefetch of `/` pulls the HOME route's client chunks, which include
 * the Supabase browser client (One Tap, the sticky CTA and the demo input all call getSession). On /blog that was 88 KB of a 476 KB page (blog: 476 KB -> 388 KB with the
 * prefetch of `/` blocked; jobs, job detail, scholarships and mentorship 28-33 KB each), for a page the visitor may never open. `prefetch={false}` on a link to `/` makes the
 * first click load the route on demand instead (a few hundred ms on slow 4G).
 *
 * This is a ratchet: every <Link> in src/ whose href can be the home route (the literal "/", or a ternary with "/" as an arm) must say prefetch={false}. The browser half,
 * that /blog really downloads no Supabase chunk, is e2e/blog-no-supabase-chunk.spec.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(name) ? [p] : [];
  });
}

/** The opening tag of every <Link ...> in a source text: from "<Link" to its closing ">" at brace depth 0 (so an arrow function or a template in a prop does not end it early). */
export function linkTags(source: string): Array<{ tag: string; line: number }> {
  const out: Array<{ tag: string; line: number }> = [];
  const re = /<Link\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + 5;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    out.push({ tag: source.slice(m.index, i + 1), line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** True when the href expression is the home route, or can be (a ternary or logical with "/" as an arm). */
export function hrefCanBeHome(tag: string): boolean {
  const m = /\bhref=(?:"([^"]*)"|\{([^]*?)\}(?=\s+[a-zA-Z-]+=|\s*\/?>|\s*$))/.exec(tag);
  if (!m) return false;
  if (m[1] !== undefined) return m[1] === "/";
  return /(^|[?:&|]\s*)["'`]\/["'`](?=\s*($|[:?)}&|]))/.test(m[2].trim()) || m[2].trim() === '"/"';
}

describe("the detector itself (so the ratchet is not vacuous)", () => {
  it("reads a literal, a ternary and a multi-line tag; ignores other routes", () => {
    expect(hrefCanBeHome('<Link href="/" className="x">')).toBe(true);
    expect(hrefCanBeHome('<Link\n  href={session ? "/jobs" : "/"}\n  className="x"\n>')).toBe(true);
    expect(hrefCanBeHome('<Link href={"/"} className="x">')).toBe(true);
    expect(hrefCanBeHome('<Link href="/jobs" className="x">')).toBe(false);
    expect(hrefCanBeHome('<Link href="/login" className="x">')).toBe(false);
    expect(hrefCanBeHome('<Link href={`/jobs/${id}`} className="x">')).toBe(false);
    expect(hrefCanBeHome('<Link href={session ? "/jobs" : "/scholarships"}>')).toBe(false);
  });
  it("splits tags at the right '>' even with an arrow function in a prop", () => {
    const tags = linkTags('<Link href="/" onClick={() => go()} prefetch={false}>Home</Link><Link href="/jobs">Jobs</Link>');
    expect(tags).toHaveLength(2);
    expect(tags[0].tag).toContain("prefetch={false}");
  });
});

describe("every link to the home route is not prefetched", () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const f of files(SRC)) {
    const src = readFileSync(f, "utf8");
    if (!src.includes("<Link")) continue;
    for (const { tag, line } of linkTags(src)) {
      if (!hrefCanBeHome(tag)) continue;
      seen++;
      if (!/\bprefetch=\{false\}/.test(tag)) offenders.push(`${f.replace(SRC, "src")}:${line}`);
    }
  }
  it("finds the links to the home route (the scan is not empty)", () => expect(seen).toBeGreaterThanOrEqual(11));
  it("none of them lacks prefetch={false}", () => expect(offenders, `add prefetch={false} to:\n${offenders.join("\n")}`).toEqual([]));
});
