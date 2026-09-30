/**
 * send-477 — the cheap, no-network half of the signed-out link ratchet.
 *
 * e2e/signed-out-link-gate.spec.ts crawls the running site. This file asks the
 * same question of the two places gated links come from in CODE, through the
 * real gate function (src/lib/auth/seeker-gate-paths.ts), in the unit job, in
 * milliseconds:
 *
 *  - the footer, rendered for real (so what is checked is what ships, not a
 *    private constant that could drift from it);
 *  - every entry of blog/related-links.ts's RELATED_LINKS. The crawl only sees
 *    the posts that exist in whatever database it runs against; CI has four
 *    posts and production has more, so this is the only check that covers a
 *    post nobody has published yet.
 *
 * Both directions are asserted, because that is what makes it a ratchet: a
 * gated link that is not in the allowlist fails (a NEW offender), and an
 * allowlist row whose link is gone fails too (remove the row, so the list can
 * only shrink).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { RELATED_LINKS } from "@/lib/blog/related-links";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import { offenderKey } from "../../scripts/link-check";
import {
  GATED_LINK_ALLOWLIST,
  enforcedForScope,
  ratchetDiff,
  type GatedLinkAllowance,
} from "../support/gated-link-allowlist";

const REPO_ROOT = path.resolve(__dirname, "../..");

function keysWithPrefix(prefix: string): string[] {
  return GATED_LINK_ALLOWLIST.map((r) => r.key).filter((k) => k.startsWith(prefix)).sort();
}

function gatedKeys(region: "footer" | "main", group: string, hrefs: string[]): string[] {
  const out = new Set<string>();
  for (const href of hrefs) {
    const u = new URL(href, "http://site.test");
    if (isProtectedSeekerPath(u.pathname)) out.add(offenderKey(region, group, u.pathname + u.search));
  }
  return [...out].sort();
}

describe("the gate function these checks rely on", () => {
  it("still gates the paths the allowlist is about (a control: an always-false gate would pass everything else here)", () => {
    for (const p of ["/jobs", "/scholarships", "/tracker", "/refer", "/resume-builder", "/tailor"]) {
      expect(isProtectedSeekerPath(p), p).toBe(true);
    }
    expect(isProtectedSeekerPath("/scholarships/apply-now")).toBe(false);
    expect(isProtectedSeekerPath("/mentorship")).toBe(false);
  });
});

describe("the footer's links against the gated-link allowlist", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);
  const hrefs = [...html.matchAll(/<a\s[^>]*?href="([^"]+)"/g)].map((m) => m[1]);

  it("renders links at all (so an empty result below means 'none gated', not 'found nothing')", () => {
    expect(hrefs.length).toBeGreaterThan(10);
    expect(hrefs).toContain("/legal/privacy");
  });

  it("has no gated link that the allowlist does not list, and the allowlist lists no footer link that is gone", () => {
    expect(gatedKeys("footer", "*", hrefs)).toEqual(keysWithPrefix("footer:* -> "));
  });
});

describe("blog related links against the gated-link allowlist", () => {
  const hrefs = Object.values(RELATED_LINKS).flatMap((links) => links.map((l) => l.href));

  it("has entries at all (RELATED_LINKS is exported for exactly this check)", () => {
    expect(Object.keys(RELATED_LINKS).length).toBeGreaterThan(5);
    expect(hrefs).toContain("/mentorship");
  });

  it("has no gated link that the allowlist does not list, and the allowlist lists no blog link that is gone", () => {
    expect(gatedKeys("main", "/blog/*", hrefs)).toEqual(keysWithPrefix("main:/blog/* -> "));
  });
});

describe("the allowlist itself", () => {
  const rows: readonly GatedLinkAllowance[] = GATED_LINK_ALLOWLIST;

  it("has unique keys, in the shape offenderKey() produces", () => {
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k, k).toMatch(/^(footer|header):\* -> \/\S*$|^main:(\/\S*|404) -> \/\S*$/);
    }
  });

  it("says what removes each row, and where each link comes from", () => {
    for (const r of rows) {
      expect(r.followUp.trim().length, `${r.key}: followUp`).toBeGreaterThan(0);
      expect(r.sources.length, `${r.key}: sources`).toBeGreaterThan(0);
    }
  });

  it("points at files that exist and still contain the label they name (line numbers rot, labels don't)", () => {
    for (const r of rows) {
      for (const s of r.sources) {
        const file = path.join(REPO_ROOT, s.file);
        expect(fs.existsSync(file), `${r.key}: ${s.file} does not exist`).toBe(true);
        expect(fs.readFileSync(file, "utf8"), `${r.key}: ${s.file} no longer contains "${s.label}"`).toContain(s.label);
      }
    }
  });

  it("enforces staleness on ci rows always and on prod-only rows only in the 'all' scope", () => {
    const ci: GatedLinkAllowance = { key: "footer:* -> /x", coverage: "ci", sources: [], followUp: "x" };
    const prod: GatedLinkAllowance = { ...ci, coverage: "prod-only" };
    expect(enforcedForScope(ci, "ci")).toBe(true);
    expect(enforcedForScope(prod, "ci")).toBe(false);
    expect(enforcedForScope(prod, "all")).toBe(true);
  });
});

describe("ratchetDiff — the comparison the crawl applies", () => {
  const row = (key: string, coverage: "ci" | "prod-only" = "ci"): GatedLinkAllowance => ({
    key,
    coverage,
    sources: [],
    followUp: "x",
  });
  const rows = [row("footer:* -> /a"), row("main:/ -> /b"), row("main:/blog/* -> /c", "prod-only")];

  it("passes when observed and listed match exactly", () => {
    expect(ratchetDiff(["footer:* -> /a", "main:/ -> /b", "main:/blog/* -> /c"], "all", rows)).toEqual({ fresh: [], stale: [] });
  });

  it("fails a NEW offender: a gated link no row accounts for", () => {
    const diff = ratchetDiff(["footer:* -> /a", "main:/ -> /b", "main:/about -> /tracker"], "ci", rows);
    expect(diff.fresh).toEqual(["main:/about -> /tracker"]);
  });

  it("fails an offender that was fixed but whose row was left behind", () => {
    const diff = ratchetDiff(["main:/ -> /b"], "ci", rows);
    expect(diff.stale).toEqual(["footer:* -> /a"]);
  });

  it("does not treat a prod-only row as stale in CI scope, but does in 'all' scope", () => {
    const observed = ["footer:* -> /a", "main:/ -> /b"];
    expect(ratchetDiff(observed, "ci", rows).stale).toEqual([]);
    expect(ratchetDiff(observed, "all", rows).stale).toEqual(["main:/blog/* -> /c"]);
  });

  it("a crawl that observed nothing cannot pass against a non-empty list", () => {
    expect(ratchetDiff([], "ci", rows).stale.length).toBeGreaterThan(0);
  });

  it("holds for the real allowlist: observing exactly its own keys is clean", () => {
    expect(ratchetDiff(GATED_LINK_ALLOWLIST.map((r) => r.key), "all")).toEqual({ fresh: [], stale: [] });
  });
});
