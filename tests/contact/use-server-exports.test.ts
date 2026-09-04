/**
 * Every export from a "use server" file must be an async function — Next's
 * own documented rule (https://nextjs.org/docs/messages/invalid-use-server-value).
 * src/lib/contact/actions.ts broke it (exported a plain object,
 * initialContactActionState) and it crashed real production requests to
 * /contact with exactly that error, 12 times across 6 users, confirmed via
 * Vercel's own runtime error log.
 *
 * WHY THIS IS A STRUCTURAL TEST, NOT A ROUTE/RENDER ONE. That's what was
 * asked for, and it was tried first: neither `next dev` (Turbopack) nor a
 * full local `next build && next start` reproduced the crash — both served
 * /contact fine with the bad export still in place, and `npm run build`
 * completed cleanly both times. The failure is specific to Vercel's actual
 * serverless bundling of SSR chunks (the real stack trace pulled from
 * Vercel's runtime logs shows it throwing from inside `.next/server/chunks/
 * ssr/..._.js` during `commonJsRequire`, a code path this repo's local
 * tooling — and therefore CI's Playwright suite, which also builds+starts
 * locally — never exercises). A browser/e2e test against a local build
 * would have stayed green with the bug still present, which is also why CI
 * never caught this the first time. This test instead reproduces the rule
 * itself, directly, the same way Next's own compiler checks it: every
 * runtime export of a "use server" module must be a function.
 *
 * Kept generic across every "use server" file in the repo, not just
 * contact/actions.ts, so a future file makes the same mistake exactly once.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../src");

function findUseServerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findUseServerFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      const firstLine = readFileSync(full, "utf-8").split("\n", 5).find((l) => l.trim().length > 0);
      if (firstLine && /^["']use server["'];?$/.test(firstLine.trim())) {
        found.push(full);
      }
    }
  }
  return found;
}

const useServerFiles = findUseServerFiles(SRC_ROOT);

describe(`every "use server" file's runtime exports are async functions`, () => {
  it("found at least one file to check — a suite that checks nothing proves nothing", () => {
    // Sabotage-proof for the CHECK ITSELF: if this ever reads 0, the glob
    // broke, not the codebase — the repo has 25+ of these files.
    expect(useServerFiles.length).toBeGreaterThan(15);
  });

  it.each(useServerFiles.map((f) => [path.relative(SRC_ROOT, f), f] as const))(
    "%s",
    async (_relPath, absPath) => {
      const modulePath = "@/" + path.relative(SRC_ROOT, absPath).replace(/\.tsx?$/, "");
      const mod: Record<string, unknown> = await import(/* @vite-ignore */ modulePath);
      for (const [name, value] of Object.entries(mod)) {
        // Type-only exports (interfaces, `type` aliases) are erased by
        // TypeScript and produce no runtime binding at all — nothing to
        // check for those, and they're the majority of the non-function
        // exports this repo's "use server" files legitimately have
        // (AuthActionState, EmployerActionState, BlogActionState, etc.).
        // Only an actual RUNTIME value — the exact shape of the original
        // bug — can violate Next's rule.
        if (value === undefined) continue;
        expect(
          typeof value,
          `${modulePath}'s export "${name}" is a runtime ${typeof value}, not a function — ` +
            `a "use server" file can only export async functions (or type-only bindings, which ` +
            `aren't checked here because they don't exist at runtime)`,
        ).toBe("function");
      }
    },
  );
});
