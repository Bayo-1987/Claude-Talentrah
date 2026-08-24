import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// The upload spec talks to Supabase directly to mint a test user, so it
// needs the same credentials the app does. CI injects these as workflow env;
// locally they live in .env.local, which Playwright does not read on its own.
loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  // Assumes the app is already running at baseURL (locally that's the
  // Browser pane's `npm run dev`; in CI, ci.yml builds and starts it itself
  // and seeds demo data before this runs) — not launching a webServer here
  // to avoid a second Next.js instance fighting over :3000 locally.
});
