/**
 * send-491 — the homepage hero demo's quick-action links.
 *
 * "Build a resume" linked straight to /resume-builder, which is login-gated: a signed-out visitor who clicked
 * it was sent to /login (the production crawl listed it as a gated link, and the owner's founder QA audit
 * flagged it as the top signed-out dead end). It is now session-aware:
 *
 *   signed in  -> /resume-builder (the tool itself)
 *   signed out -> /signup?redirectTo=%2Fresume-builder (the same shape as its sibling quick actions, which go
 *                 to /signup; signup returns the new account to the builder)
 *
 * WHY SESSION-AWARE IS SAFE HERE. `isSignedIn` is read in the BROWSER (a cookie read in an effect), never on the
 * server; the page's HTML is static and shared, and ships the signed-out variant to everyone (unknown reads as
 * signed out). So one visitor's state can never be served to another from a cache, and the signed-out first
 * paint, which is also what the crawl sees, is the signup link. A signed-in visitor on that link before the
 * swap lands is forwarded by /signup itself (it redirects a signed-in user straight to redirectTo).
 * e2e/signed-out-link-repoints.spec.ts proves both states in a browser.
 *
 * The three sibling quick actions are pinned unchanged, and so is the signed-in-only "Build or upload your
 * resume" link further down the component (it only renders for a signed-in user with no base resume, so
 * /resume-builder is correct there).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JdDemoInput } from "@/components/marketing/jd-demo-input";

type QuickAction = { label: string; href: string };

/** Imported dynamically and narrowed, so this file compiles before the export exists (the tests-first commit). */
async function quickActionsFor(signedIn: boolean): Promise<QuickAction[]> {
  const mod = (await import("@/components/marketing/jd-demo-input")) as {
    quickActionsFor?: (signedIn: boolean) => QuickAction[];
  };
  expect(mod.quickActionsFor, "jd-demo-input must export quickActionsFor(signedIn)").toBeTypeOf("function");
  return mod.quickActionsFor!(signedIn);
}

const SIBLINGS: QuickAction[] = [
  { label: "Tailor my resume to a job", href: "/signup" },
  { label: "Check my match score", href: "/signup" },
  { label: "Find a scholarship", href: "/scholarships" },
];

describe("hero demo quick actions (send-491)", () => {
  it("signed out: 'Build a resume' goes through signup and returns to the builder", async () => {
    const actions = await quickActionsFor(false);
    expect(actions.find((a) => a.label === "Build a resume")).toEqual({
      label: "Build a resume",
      href: "/signup?redirectTo=%2Fresume-builder",
    });
  });

  it("signed in: 'Build a resume' goes straight to the builder", async () => {
    const actions = await quickActionsFor(true);
    expect(actions.find((a) => a.label === "Build a resume")).toEqual({ label: "Build a resume", href: "/resume-builder" });
  });

  it("the three sibling quick actions and the order are the same in both states", async () => {
    for (const signedIn of [false, true]) {
      const actions = await quickActionsFor(signedIn);
      expect(actions.map((a) => a.label), `signedIn=${signedIn}`).toEqual([
        "Tailor my resume to a job",
        "Check my match score",
        "Build a resume",
        "Find a scholarship",
      ]);
      for (const sib of SIBLINGS) expect(actions).toContainEqual(sib);
    }
  });

  it("the server-rendered first paint (what every stranger and the crawl get) is the signed-out variant", () => {
    const html = renderToStaticMarkup(<JdDemoInput />);
    expect(html).toMatch(/<a [^>]*href="\/signup\?redirectTo=%2Fresume-builder"[^>]*>Build a resume</);
    // No link to the gated builder in the first paint: the only /resume-builder link in this component is
    // the signed-in-only one, which does not render until a signed-in submit is answered.
    expect(html).not.toMatch(/href="\/resume-builder"/);
    // Control: the other links did render, so "no gated link" is not an empty-render pass.
    expect(html).toMatch(/href="\/scholarships"[^>]*>Find a scholarship</);
    expect(html).toMatch(/href="\/jobs"[^>]*>Browse jobs instead/);
  });

  it("the signed-in-only 'Build or upload your resume' link is unchanged: still /resume-builder", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../src/components/marketing/jd-demo-input.tsx"), "utf8");
    const at = src.indexOf("Build or upload your resume");
    expect(at, "the link text is gone").toBeGreaterThan(0);
    // The nearest href before the text is /resume-builder.
    const before = src.slice(0, at);
    expect(before.slice(before.lastIndexOf("href="))).toMatch(/^href="\/resume-builder"/);
  });
});
