import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    /*
     * Nested checkouts. Agent worktrees land under .claude/worktrees/, which
     * git excludes but eslint does not — so a worktree becomes a second copy
     * of every source file, linted with the wrong relative paths. The visible
     * symptom is the e2e/fixtures override below silently not applying:
     * `e2e/fixtures/**` does not match
     * `.claude/worktrees/<name>/e2e/fixtures/`, so a clean tree starts
     * reporting rules-of-hooks errors that CI never sees, in files nobody
     * touched. Linting another checkout is never what was wanted.
     */
    ".claude/worktrees/**",
  ]),
  {
    // Playwright fixtures take a callback argument named `use`, which the
    // React hooks rule reads as a hook called outside a component. It isn't
    // React at all — these files never run in the browser bundle. Scoped to
    // the fixtures directory so the rule keeps its teeth everywhere else.
    files: ["e2e/fixtures/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    // useMounted's whole job (#142) is the canonical post-hydration mount
    // flag: flip a boolean inside an empty-deps useEffect so client-only
    // controls stay honestly disabled until it is actually safe to click
    // them. That IS "setState synchronously inside a bare effect" — the
    // exact shape this rule exists to catch, because it's usually a sign an
    // effect should be a plain event handler or derived value instead. Here
    // it's the one legitimate exception: there is no event to handle and no
    // value to derive, only "has the browser committed and attached
    // handlers yet", which nothing but an effect can answer. See the
    // hook's own docblock for the full reasoning. Scoped to this one file
    // so the rule keeps its teeth everywhere else.
    files: ["src/hooks/use-mounted.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);

export default eslintConfig;
