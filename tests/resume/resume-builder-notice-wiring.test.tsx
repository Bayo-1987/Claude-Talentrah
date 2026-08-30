/**
 * The Resume Builder page actually renders the empty-skills notice (#145).
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
 *
 * `empty-skills-notice.test.ts` proves the predicate decides correctly and
 * `empty-skills-notice-render.test.tsx` proves the component says the right
 * thing. Neither notices if the component is deleted from the page, or if the
 * two queries feeding it are broken or reordered — every one of those tests
 * would stay green while the notice silently never appeared again. Which is
 * precisely the failure mode #145 exists to end: a user who cannot be scored
 * being told nothing.
 *
 * ── WHY IT MOCKS RATHER THAN LOGGING IN ───────────────────────────────────
 *
 * The obvious version is a Playwright spec with a fixture account, and it was
 * written, run, and deliberately deleted. Every auth user this suite creates
 * adds to the shared-CI-database contention tracked in #136 — the same load
 * that was trimmed out of the match-scores tests earlier the same day.
 *
 * So this drives the real page function with a fake Supabase client and no
 * account at all. It is a genuinely weaker test than the browser one: it
 * cannot catch CSS that hides the notice, or hydration that removes it. What
 * it does catch is the whole class the unit tests miss — the component being
 * unwired from its data — for zero auth cost.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const USER_ID = "00000000-0000-0000-0000-0000000000aa";
const BASE_RESUME_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ user: { id: USER_ID } }),
}));

interface Fixture {
  baseResume: { id: string; structured_content: unknown } | null;
  dismissedAt: string | null;
}

let fixture: Fixture;

/*
 * A chainable stand-in for the Supabase query builder.
 *
 * Thenable, so the calls the page awaits directly inside its Promise.all
 * resolve; and carrying `maybeSingle`, which is how the two queries this test
 * is about are terminated. Which fixture a call receives is decided by the
 * TABLE AND THE SELECT LIST TOGETHER — `resumes` is queried twice on this
 * page with different columns, and keying on the table alone would hand the
 * notice the resume LIST and quietly pass.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const state: { table: string; select: string } = { table, select: "" };
      const result = () => {
        if (state.table === "resumes" && state.select.includes("structured_content")) {
          return { data: fixture.baseResume, error: null };
        }
        if (state.table === "resumes") return { data: [], error: null };
        if (state.table === "profiles") {
          return { data: { resume_skills_notice_dismissed_at: fixture.dismissedAt }, error: null };
        }
        if (state.table === "resume_templates") return { data: [], count: 0, error: null };
        return { data: [], error: null };
      };
      const chain = {
        select(sel: string) {
          state.select = sel;
          return chain;
        },
        eq: () => chain,
        ilike: () => chain,
        order: () => chain,
        range: () => chain,
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(onOk, onErr),
      };
      return chain;
    },
  }),
}));

const { default: ResumeBuilderPage } = await import("@/app/(app)/resume-builder/page");

async function renderPage(f: Fixture) {
  fixture = f;
  const element = await ResumeBuilderPage({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element);
}

const NOTICE = 'data-testid="empty-skills-notice"';

describe("the page renders the notice when the data says it should", () => {
  it("shows it for a base resume with an empty skills array", async () => {
    const html = await renderPage({
      baseResume: { id: BASE_RESUME_ID, structured_content: { skills: [], experience: [] } },
      dismissedAt: null,
    });
    expect(html, "the notice is not wired into the page").toContain(NOTICE);
    // Wired to the RIGHT resume — an edit link pointing elsewhere is a
    // working-looking notice that sends the user to the wrong document.
    expect(html).toContain(`/resume-builder/edit?resumeId=${BASE_RESUME_ID}`);
  });

  it("shows it when the skills key is absent entirely", async () => {
    const html = await renderPage({
      baseResume: { id: BASE_RESUME_ID, structured_content: { experience: [] } },
      dismissedAt: null,
    });
    expect(html).toContain(NOTICE);
  });
});

describe("the page leaves it out when the data says it should", () => {
  it("omits it for a resume that has skills", async () => {
    const html = await renderPage({
      baseResume: { id: BASE_RESUME_ID, structured_content: { skills: ["sql", "figma"] } },
      dismissedAt: null,
    });
    expect(html, "the notice showed for a resume that HAS skills").not.toContain(NOTICE);
  });

  it("omits it once dismissed", async () => {
    // Proves the profiles query is actually read, not just issued.
    const html = await renderPage({
      baseResume: { id: BASE_RESUME_ID, structured_content: { skills: [] } },
      dismissedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(html, "a dismissal was recorded but the page ignored it").not.toContain(NOTICE);
  });

  it("omits it for a user with no base resume", async () => {
    const html = await renderPage({ baseResume: null, dismissedAt: null });
    expect(html).not.toContain(NOTICE);
  });
});

describe("the rest of the page is unaffected", () => {
  it("still renders, so a broken notice query cannot blank the builder", async () => {
    const html = await renderPage({ baseResume: null, dismissedAt: null });
    expect(html).toContain("Build a resume that fits the role.");
  });
});
