import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Both the authed fixture and the upload spec talk to Supabase directly to
// mint test users, so they need the same credentials the app does. CI
// injects these as workflow env; locally they live in .env.local, which
// Playwright — unlike Vitest's tests/setup.ts — does not read on its own.
loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  // Refuse production (or the shared hosted project) before any spec loads: send-507, tests/support/e2e-db-guard.test.ts.
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // Kept only for a failing test (never on a pass: CI time and size). The HTML report in playwright-report/ then carries the trace, so a failure
    // such as a lost focus can be inspected step by step instead of guessed at from one error line.
    trace: "retain-on-failure",
  },
  // Assumes the app is already running at baseURL (locally that's the
  // Browser pane's `npm run dev`; in CI, ci.yml builds and starts it itself
  // and seeds demo data before this runs) — not launching a webServer here
  // to avoid a second Next.js instance fighting over :3000 locally.
  //
  // A failure that only reproduces against `npm run dev` and NOT against
  // `npm run build && npm run start` (CI's actual e2e-job commands, see
  // .github/workflows/ci.yml) is a strong signal the failure is a dev-mode
  // artifact, not a real regression — check that before spending time
  // instrumenting a bug that may not exist outside dev mode.
});
