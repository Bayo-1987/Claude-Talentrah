import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    /*
     * Runs ONCE per vitest invocation, before any file — unlike setupFiles,
     * which runs per file and would fire this 21 times in parallel. See the
     * file's own header for why the cleanup lives here rather than in an
     * afterAll or a cron.
     */
    globalSetup: ["./tests/global-setup.ts"],
    /*
     * `.tsx` as well as `.ts`. The template suite renders real components with
     * react-dom/server, which needs JSX — and a file that does not match this
     * glob is not reported as skipped, it is simply never collected. The
     * rendering tests were silently absent from a green run before this was
     * widened, which is the failure mode worth naming: an uncollected test
     * file looks exactly like a passing one.
     */
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
    /*
     * Hooks get the same budget as tests, not vitest's 10s default.
     *
     * Every DB-backed suite here creates auth users in beforeAll/beforeEach
     * against the shared live Supabase project — there is no staging database
     * (CLAUDE.md). A single createUser is ~750ms idle, but the suite runs 21
     * files in parallel and CI runs against the same project, so under
     * contention those hooks routinely cross 10s. The symptom is misleading:
     * the FILE is reported failed with "Hook timed out in 10000ms" while every
     * test in it passed, or its tests are all marked skipped.
     *
     * Three files had already been patched individually with `, 60_000` —
     * spend-race, rate-limit and referrals — which is the same fix applied
     * three times and still leaves every other suite exposed. This is the
     * class fix; the per-file overrides are now redundant but harmless, and
     * are left in place because each documents why its own hook is slow.
     *
     * A raised ceiling does not hide a hang: a genuinely stuck hook still
     * fails, just at 60s. What it stops doing is failing healthy runs.
     */
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
