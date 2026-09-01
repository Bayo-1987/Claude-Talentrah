/**
 * The blog routes keep a bounded revalidation window.
 *
 * ── WHY THIS IS PINNED ────────────────────────────────────────────────────
 *
 * Publish, unpublish, edit and delete all call `revalidatePath` from their
 * Server Actions, so the normal path is instant and this value never comes
 * into it. It exists for the case where something reaches `blog_posts`
 * WITHOUT going through those actions — a migration, a bulk tool, a script.
 *
 * That happened during the 0074 rollout: a row deleted straight through the
 * database connector left /blog/<slug> serving a cached 200 while the listing
 * and sitemap correctly showed it gone. With no time bound the page was stuck
 * until a redeploy, and a redeploy is what it took to clear it.
 *
 * Because the mechanism only fires when nothing else does, removing it breaks
 * nothing that any other test observes — every functional test goes through
 * the Server Actions and would stay green. Hence a test on the value itself.
 *
 * ── WHY THE SOURCE AND NOT THE MODULE ─────────────────────────────────────
 *
 * `revalidate` is a route-segment config export read by the Next compiler at
 * build time, not by anything at runtime. Importing the page to inspect it
 * would drag in the whole server component graph to assert a build-time
 * contract, so the contract is read where it is declared.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES = [
  ["the post route", "src/app/blog/[slug]/page.tsx"],
  ["the listing", "src/app/blog/page.tsx"],
] as const;

/** An hour. Long enough not to compete with revalidatePath, short enough to self-heal. */
const MAX_WINDOW_SECONDS = 3600;

describe("blog pages cannot get permanently stuck stale", () => {
  it.each(ROUTES)("%s declares a bounded revalidate", (_label, file) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const match = src.match(/^export const revalidate = (\d+);$/m);

    expect(match, `${file} has no \`export const revalidate\` — a page there can stick stale forever`)
      .not.toBeNull();

    const seconds = Number(match![1]);
    expect(seconds, "revalidate must be a positive number of seconds").toBeGreaterThan(0);
    expect(
      seconds,
      `a window longer than ${MAX_WINDOW_SECONDS}s stops being a backstop`,
    ).toBeLessThanOrEqual(MAX_WINDOW_SECONDS);
  });

  it("the sitemap self-corrects too, by being dynamic rather than timed", () => {
    // Different mechanism, same guarantee: it queries live on every request,
    // so it never needed a window. Pinned so nobody "optimises" it into a
    // static page and reintroduces the stuck-stale class here.
    const src = readFileSync(join(process.cwd(), "src/app/sitemap.ts"), "utf8");
    expect(src).toMatch(/^export const dynamic = "force-dynamic";$/m);
  });
});
