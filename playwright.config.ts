import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  // Assumes `npm run dev` is already running (this project's dev server is
  // managed by the Browser pane elsewhere in normal use) — not launching a
  // webServer here to avoid a second Next.js instance fighting over :3000.
});
