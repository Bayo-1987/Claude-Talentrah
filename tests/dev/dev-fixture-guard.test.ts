/**
 * QA fixture pages (/dev/*) must never be served by the production deployment.
 *
 * A fixture mounts real components with no auth and no database so an e2e can drive them. CI runs the same production
 * BUILD (`next build && next start`, NODE_ENV=production) the fixtures are exercised against, so NODE_ENV alone cannot
 * tell CI from the live site; Vercel's own `VERCEL_ENV` can: it is "production" on the live deployment and absent in CI.
 * The guard therefore refuses exactly when VERCEL_ENV is "production".
 *
 * Found while adding the file-input fixture: /dev/design-check and /dev/resume-editor-fixture answer 200 on the live site
 * today, and /dev/banner-crop-fixture (#663) would too once deployed.
 */
// Loaded first, while NODE_ENV is still "test": the dev JSX runtime is cached by Node, and a later NODE_ENV=production stub
// must not swap it for the production one (which has no jsxDEV) when a fixture page is imported below.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModule } from "../support/load-module";

interface Guard {
  isDevFixtureAllowed(env?: Record<string, string | undefined>): boolean;
}
const load = () => loadModule<Guard>("@/lib/dev/dev-fixture-guard");

describe("isDevFixtureAllowed", () => {
  it("refuses on the live site: VERCEL_ENV=production with NODE_ENV=production", async () => {
    const { isDevFixtureAllowed } = await load();
    expect(isDevFixtureAllowed({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
  });

  it("refuses when VERCEL_ENV=production whatever NODE_ENV says", async () => {
    const { isDevFixtureAllowed } = await load();
    expect(isDevFixtureAllowed({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(false);
  });

  it("allows CI's production build (NODE_ENV=production, no VERCEL_ENV): the e2e suite needs it", async () => {
    const { isDevFixtureAllowed } = await load();
    expect(isDevFixtureAllowed({ NODE_ENV: "production" })).toBe(true);
  });

  it("allows local development and test builds", async () => {
    const { isDevFixtureAllowed } = await load();
    expect(isDevFixtureAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(isDevFixtureAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("allows Vercel preview deployments (they are not the live site)", async () => {
    const { isDevFixtureAllowed } = await load();
    expect(isDevFixtureAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
  });
});


