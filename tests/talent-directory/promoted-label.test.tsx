/**
 * V5 label (V5-LABEL-AND-COPY-1): the employer's Talent Directory LIST draws a visible "Promoted" label on the rows the database placed in the Promoted strip (section "promoted", migration 0268), and
 * nothing on any other row. The label is the database's answer carried through searchTalentDirectory (an unknown or missing value already reads as "organic" there, tests/talent-directory/search-section.test.ts);
 * this file pins the other half: what the page draws for each answer, including answers it should never see. The candidate's own page does not show it (V5 report 9.3).
 *
 *   - a "promoted" row shows the label, once, on its own card; an "organic" row shows none;
 *   - a section that is missing, null, empty, differently cased, a number or a made-up word shows none: only the exact string "promoted" draws the label;
 *   - the label is not a link or a control and is not in the tab order (the card's tab order is unchanged: the name link, then "What this means");
 *   - the label's text is ONE source (src/lib/talent-directory/promoted-label.ts): no other file under the Talent Directory code names the word as a string or as text, so a second spelling cannot drift;
 *   - the candidate's own page does not show it.
 * The page is rendered for real (async server component awaited, then rendered to static markup); only the data edges are replaced, as in tests/talent-directory/review-badge-surfaces.test.tsx.
 * vitest here is plain Node: the label's look (contrast, size) is checked by its classes below and by eye, not by a browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DirectoryCandidate } from "@/lib/talent-directory/queries";

const state = vi.hoisted(() => ({ candidates: [] as unknown[] }));

vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ userId: "u1", userEmail: "o@example.com", emailConfirmed: true, organization: { id: "org-1", name: "Acme" }, role: "owner" }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.gt = () => q;
      q.maybeSingle = async () => ({ data: table === "talent_directory_subscriptions" ? { status: "active", expires_at: "2027-01-01T00:00:00Z" } : null, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/talent-directory/queries", () => ({
  getTalentDirectoryPreview: async () => ({ count: 0, samples: [] }),
  searchTalentDirectory: async () => state.candidates,
  getCandidatePortfolioItems: async () => [],
  getOwnContactRequestStatus: async () => null,
}));
vi.mock("@/lib/talent-directory/subscription-actions", () => ({ purchaseTalentDirectorySubscriptionAction: async () => {} }));
vi.mock("@/lib/talent-directory/waitlist-actions", () => ({ joinTalentDirectoryWaitlistAction: async () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); }, useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const base: DirectoryCandidate = { userId: "c1", firstName: "Ada", lastName: "Okafor", country: "Nigeria", availableForHire: true, remoteReady: true, earliestStartDate: null, verifiedAt: "2026-10-05T09:30:00Z", reviewType: "ai", section: "organic" };
const person = (id: string, first: string, section: unknown): unknown => ({ ...base, userId: id, firstName: first, lastName: "Test", section });

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const cards = (html: string) => [...html.matchAll(/<li[\s>][\s\S]*?<\/li>/g)].map((m) => m[0]);
const LABEL = /data-testid="promoted-label"/g;

beforeEach(() => {
  state.candidates = [];
});

describe("the directory list draws the label on promoted rows and nowhere else", async () => {
  const { default: Page } = await import("@/app/employer/talent-directory/page");
  const render = async () => text(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) })));

  it("a promoted row shows the label, once, on its own card, before the name; the organic rows around it show none", async () => {
    state.candidates = [person("p1", "Promo", "promoted"), person("o1", "Organic", "organic"), person("o2", "Other", "organic")];
    const html = await render();
    const [first, second, third] = cards(html);
    expect(html.match(LABEL)).toHaveLength(1);
    expect(first).toContain("Promo Test");
    expect(first.match(LABEL)).toHaveLength(1);
    expect(first.indexOf('data-testid="promoted-label"')).toBeLessThan(first.indexOf("Promo Test"));
    expect(second).not.toMatch(LABEL);
    expect(third).not.toMatch(LABEL);
  });

  it("the label says Promoted, in words, and is visible text (not an icon, a colour or an attribute)", async () => {
    state.candidates = [person("p1", "Promo", "promoted")];
    const html = await render();
    expect(html).toMatch(/<span[^>]*data-testid="promoted-label"[^>]*>Promoted<\/span>/);
    expect(html).not.toMatch(/aria-label="[^"]*Promoted/i);
    expect(html).not.toMatch(/sr-only[^>]*>[^<]*Promoted/i);
  });

  it("an organic row shows no label", async () => {
    state.candidates = [person("o1", "Organic", "organic")];
    expect(await render()).not.toMatch(LABEL);
  });

  it.each([[undefined], [null], [""], ["Promoted"], ["PROMOTED"], [" promoted"], ["promoted "], ["featured"], ["sponsored"], [7], [true], [{}]])("a section of %j shows no label (only the exact string 'promoted' does)", async (value) => {
    state.candidates = [person("x1", "Strange", value)];
    expect(await render()).not.toMatch(LABEL);
  });

  it("a candidate with no section field at all shows no label", async () => {
    const { section: _omitted, ...noSection } = base;
    void _omitted;
    state.candidates = [noSection];
    expect(await render()).not.toMatch(LABEL);
  });

  it("every promoted row is labelled and no other is, in a mixed page (three promoted among five)", async () => {
    state.candidates = [person("p1", "A", "promoted"), person("p2", "B", "promoted"), person("p3", "C", "promoted"), person("o1", "D", "organic"), person("o2", "E", "organic")];
    const html = await render();
    expect(cards(html).map((c) => (c.match(LABEL) ?? []).length)).toEqual([1, 1, 1, 0, 0]);
  });

  it("the label is plain text: not a link, not a button, not focusable, and the card's tab order is unchanged", async () => {
    state.candidates = [person("p1", "Promo", "promoted")];
    const html = await render();
    const card = cards(html)[0];
    const label = card.match(/<span[^>]*data-testid="promoted-label"[^>]*>[^<]*<\/span>/)![0];
    expect(label).not.toMatch(/tabindex|href|role=|onclick|<a\s|<button/i);
    expect(card.indexOf("data-testid=\"promoted-label\"")).toBeLessThan(card.indexOf('href="/employer/talent-directory/p1"'));
    const stops = [...card.matchAll(/<a\s|<summary|<button/g)].length;
    expect(stops).toBe(3); // the name link, "What this means", "How we review" (exactly the stops of an unlabelled card)
    state.candidates = [person("o1", "Organic", "organic")];
    expect([...cards(await render())[0].matchAll(/<a\s|<summary|<button/g)].length).toBe(3);
  });

  it("the label is not inside the name link", async () => {
    state.candidates = [person("p1", "Promo", "promoted")];
    const card = cards(await render())[0];
    const link = card.match(/<a [^>]*href="\/employer\/talent-directory\/p1"[^>]*>[\s\S]*?<\/a>/)![0];
    expect(link).not.toContain("promoted-label");
  });

  it("looks like the site's other paid-placement label: solid ink, paper text, bold, tracked capitals, no radius, no new colour", async () => {
    state.candidates = [person("p1", "Promo", "promoted")];
    const label = (await render()).match(/<span[^>]*data-testid="promoted-label"[^>]*>/)![0];
    for (const cls of ["bg-ink", "text-paper", "font-bold", "uppercase", "tracking-[0.14em]"]) expect(label, cls).toContain(cls);
    expect(label).not.toMatch(/rounded|shadow|bg-(green|amber|rust|rust-soft)|text-(green|amber|rust)/);
  });
});

describe("the candidate's own page does not show the label", async () => {
  it("the page source never reads or draws a section", () => {
    const src = readFileSync(join(__dirname, "../../src/app/employer/talent-directory/[candidateId]/page.tsx"), "utf8");
    expect(src).not.toMatch(/\.section\b|\bsection\s*[:=]|promoted-label|PromotedLabel|isPromoted/i); // a <section> element is fine; reading the candidate's section field is not
  });
});

describe("the label's text is one source", () => {
  const ROOT = join(__dirname, "../..");
  const DIRS = ["src/lib/talent-directory", "src/components/talent-directory", "src/app/employer/talent-directory", "src/app/(app)/talent-directory"];
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  /** Code with comments removed, so a note about the word is not counted as a second spelling of it. */
  const code = (f: string) => readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const WORD = /\bPromoted\b/;

  it("the constant exists and is the word", async () => {
    const mod = await import("@/lib/talent-directory/promoted-label");
    expect(mod.PROMOTED_LABEL).toBe("Promoted");
  });

  it("no file under the Talent Directory code spells the word except the one constant file", () => {
    const offenders = DIRS.flatMap((d) => walk(d)).filter((f) => f !== "src/lib/talent-directory/promoted-label.ts" && WORD.test(code(f)));
    expect(offenders).toEqual([]);
    expect(code("src/lib/talent-directory/promoted-label.ts")).toMatch(WORD);
  });

  it("the component draws the constant, not a literal", () => {
    const src = code("src/components/talent-directory/promoted-label.tsx");
    expect(src).toContain("PROMOTED_LABEL");
    expect(src).not.toMatch(/>\s*[A-Za-z]+\s*</); // no literal text between tags
  });
});
