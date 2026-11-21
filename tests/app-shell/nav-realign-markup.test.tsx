/**
 * NAV-DROPDOWN-REALIGN-1 (owner decision OWNER-DECISION-NAV-DEFAULTS-1), what the seeker masthead renders.
 * Written BEFORE the change: every test here that asserts the new behaviour is red on the old masthead.
 *
 *   - the bar carries the eight links in the owner's order (Refer a Friend is gone from it);
 *   - "Post a job" appears once at every width: the bar link from 900, the menu row only under 900;
 *   - "Ask Farah" is no longer in the dropdown; the desktop bar button (1536 and up) stays;
 *   - Refer a Friend is handed to the account menu, for seekers only (the employer header never passes it);
 *   - the phone disclosure now stands down at 1024, where the bar takes over.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

// useRouter: the account menu mounts a prefetch for Refer a Friend (PrefetchOnMount); the markup it adds is nothing, but the hook is called during render.
vi.mock("next/navigation", () => ({ usePathname: () => "/jobs", useRouter: () => ({ prefetch: () => undefined }) }));
const { Masthead } = await import("@/components/app-shell/masthead");
const { ASK_FARAH_BAR_MIN_PX, NAV_TIGHT_GAP_BAND_PX } = await import("@/components/app-shell/nav-model");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed and whitespace flattened: the files explain the very things the checks forbid. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");

const PROPS = { initials: "AB", email: "ada@example.test", displayName: "Ada Bello", creditsBalance: 12, activePass: null };
const OWNER_ORDER = ["/jobs", "/tracker", "/auto-apply", "/resume-builder", "/scholarships", "/mentorship", "/talent-directory/verify", "/feedback"];

describe("the bar's links", () => {
  it("are the eight links in the owner's order, and Refer a Friend is not among them", () => {
    const html = renderToStaticMarkup(<Masthead {...PROPS} />);
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
    const hrefs = [...nav.matchAll(/<a [^>]*href="([^"?]+)/g)].map((m) => m[1]);
    expect(hrefs).toEqual(OWNER_ORDER);
    expect(nav).not.toContain("Refer a Friend");
    expect(html).not.toContain("Refer a Friend");
  });
});

describe("Post a job appears once at every width", () => {
  const src = code("src/components/app-shell/masthead.tsx");
  const postJobLinks = [...src.matchAll(/<Link href="\/employer"((?:(?!<Link)[\s\S])*?)> Post a job <\/Link>/g)].map((m) => m[1]);

  it("there are exactly two in the source: the bar link and the phone-menu row", () => {
    expect(postJobLinks).toHaveLength(2);
  });
  it("the bar link shows from 900", () => {
    expect(postJobLinks.filter((a) => a.includes("min-[900px]:inline-flex"))).toHaveLength(1);
  });
  it("the menu row is hidden from 900, so the two are never on screen together", () => {
    const row = postJobLinks.find((a) => a.includes('role="menuitem"'));
    expect(row, "the menu row").toBeDefined();
    expect(row).toContain("min-[900px]:hidden");
  });
});

describe("Ask Farah", () => {
  const src = code("src/components/app-shell/masthead.tsx");
  it("is written once in the masthead: the desktop bar button, no longer a row in the dropdown", () => {
    expect(src.match(/Ask Farah <\/button>|Ask Farah <\/Link>|> Ask Farah </g) ?? []).toHaveLength(1);
    expect(src.match(/scrollToFarahPanel\(\)/g) ?? []).toHaveLength(1);
  });
  it("the one that stays is the bar button, from 1680 (it does not fit beside eight links at 1536; the docked panel covers the gap)", () => {
    const html = renderToStaticMarkup(<Masthead {...PROPS} />);
    const buttons = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Ask Farah<\/button>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain(`min-[${ASK_FARAH_BAR_MIN_PX}px]:flex`);
    expect(buttons[0]).not.toContain("2xl:flex");
    expect(ASK_FARAH_BAR_MIN_PX).toBe(1680);
  });
});

describe("Refer a Friend moves to the account menu, for seekers only", () => {
  it("the seeker masthead hands the menu a /refer link", () => {
    expect(code("src/components/app-shell/masthead.tsx")).toContain('referHref="/refer"');
  });
  it("the employer masthead never does", () => {
    expect(code("src/components/employer/employer-masthead.tsx")).not.toContain("referHref");
  });
});

describe("the phone disclosure hands over to the bar at 1024", () => {
  const src = code("src/components/app-shell/masthead.tsx");
  it("is hidden from 1024, not from 1536", () => {
    expect(src).toContain("min-[1024px]:hidden");
    expect(src).not.toContain("2xl:hidden");
  });
  it("the bar's links show from 1024, not from 1536", () => {
    const html = renderToStaticMarkup(<Masthead {...PROPS} />);
    const navTag = html.match(/<nav[^>]*>/)?.[0] ?? "";
    expect(navTag).toContain("min-[1024px]:flex");
    expect(navTag).not.toContain("2xl:flex");
  });
  it("the bar's gap tightens only in the 1480-1535 band, where seven links plus More are measured to need it", () => {
    const navTag = renderToStaticMarkup(<Masthead {...PROPS} />).match(/<nav[^>]*>/)?.[0] ?? "";
    expect(NAV_TIGHT_GAP_BAND_PX).toEqual([1480, 1535]);
    expect(navTag).toContain("min-[1480px]:max-[1535px]:gap-4");
    expect(navTag).toContain("gap-5.5");
  });
});
