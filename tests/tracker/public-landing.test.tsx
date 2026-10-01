/**
 * send-484 — TrackerPublicLanding: the signed-out visitor's entry point at `/tracker`.
 *
 * Static copy, no database: the page always answers 200, which is why /tracker sits in the sitemap's
 * STATIC_PATHS and not behind a live-count check. Every claim below is one the signed-in tracker
 * actually delivers (manual entries, per-application notes, a dated stage history, the employer-opened
 * notice from 0126) — a landing page for a feature that does not exist would be the false promise the
 * build prompt's copy rules forbid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../support/load-module";

interface LandingModule {
  TrackerPublicLanding: () => React.ReactElement;
}
interface StagesModule {
  TRACKER_STAGES: ReadonlyArray<{ key: string; label: string }>;
}

async function render() {
  const { TrackerPublicLanding } = await loadModule<LandingModule>("@/components/tracker/public-landing");
  return renderToStaticMarkup(<TrackerPublicLanding />);
}

describe("structure", () => {
  it("has exactly one <h1> and a 'Job Tracker' eyebrow, and never says 'Nigeria'", async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(">Job Tracker<");
    expect(html).not.toMatch(/nigeria/i);
  });

  it("offers a real path to create an account and to log in, both returning to /tracker", async () => {
    const html = await render();
    expect(html).toContain('href="/signup?redirectTo=%2Ftracker"');
    expect(html).toContain('href="/login?redirectTo=%2Ftracker"');
    expect(html).toContain("Create a free account");
  });

  it("scopes what is free: reading this page needs no account, tracking does", async () => {
    const html = await render();
    expect(html).toMatch(/needs a free account|with a free account/i);
    // Visible text only: the hrefs legitimately contain "/signup".
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bsign(ing)? ?up\b/i);
    expect(text).not.toMatch(/\bsign(ing)? ?in\b/i);
  });
});

describe("the stages", () => {
  it("lists every stage from TRACKER_STAGES, in order, with the labels the tracker itself uses", async () => {
    const { TRACKER_STAGES } = await loadModule<StagesModule>("@/lib/tracker/stages");
    const html = await render();
    const positions = TRACKER_STAGES.map((s) => html.indexOf(`>${s.label}<`));
    expect(positions.every((p) => p > -1), `missing a stage label: ${JSON.stringify(positions)}`).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("does not state how many stages there are (that would be a hardcoded number)", async () => {
    const html = await render();
    expect(html).not.toMatch(/\b(five|six|seven|eight|\d+)\s+stages\b/i);
  });
});

describe("the claims are ones the tracker delivers", () => {
  it("mentions manual entries, notes, the stage history, and the employer-opened notice, scoped to Talentrah applications", async () => {
    const html = await render();
    expect(html).toMatch(/found elsewhere/i);
    expect(html).toMatch(/notes?/i);
    expect(html).toMatch(/history/i);
    expect(html).toMatch(/opened your resume/i);
    expect(html).toMatch(/applied (for )?(on|through) Talentrah|through Talentrah|on Talentrah/i);
  });

  it("makes no claim about Auto-Apply, match scores or AI it does not itself deliver", async () => {
    const html = await render();
    expect(html).not.toMatch(/\d+\s?%/);
    expect(html).not.toMatch(/\b(Excellent|Good|Fair)\b/);
  });
});

describe("the stage list is never hardcoded", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/tracker/stages");
    vi.resetModules();
  });

  it("follows TRACKER_STAGES when it changes", async () => {
    vi.resetModules();
    vi.doMock("@/lib/tracker/stages", () => ({
      TRACKER_STAGES: [
        { key: "saved", label: "Zeta stage" },
        { key: "applied", label: "Omega stage" },
      ],
    }));
    const { TrackerPublicLanding } = await loadModule<LandingModule>("@/components/tracker/public-landing");
    const html = renderToStaticMarkup(<TrackerPublicLanding />);
    expect(html).toContain(">Zeta stage<");
    expect(html).toContain(">Omega stage<");
    expect(html).not.toContain(">Interviewing<");
  });
});
