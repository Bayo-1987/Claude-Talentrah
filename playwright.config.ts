import { defineConfig } from "@playwright/test";

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
