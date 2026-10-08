/**
 * Payload follow-up to #811 (owner, 7 Oct 2026): the Supabase browser client must be loaded by dynamic import, never a static one.
 *
 * #811 stopped the router's prefetch of `/` from carrying the client onto /blog. That removed one carrier, not the cause: a static `import { createClient } from
 * "@/lib/supabase/client"` puts the whole auth client (GoTrueClient) in the static chunk list of every route that renders the importing component. A dynamic `import()` keeps
 * it out of that list, so prefetch and first paint do not carry it; it loads right after mount, off the critical path.
 *
 * This is a ratchet: no file under src/ may import the client statically, except the files in ALLOWLIST. The allowlist holds exactly the files not yet converted (the One Tap
 * component, a separate careful-lane change, because it is the Google sign-in completion path) and a stale entry fails the second test, so the list can only shrink.
 * The browser half, that /blog really downloads no Supabase chunk, is e2e/blog-no-supabase-chunk.spec.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../../src");

/** Files that still import the client statically. Remove an entry when its file is converted. */
const ALLOWLIST = ["src/components/auth/google-one-tap.tsx"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(name) ? [p] : [];
  });
}

/**
 * True when a source text imports (or re-exports from) the browser client statically: any `import ... from "<client>"`, `import "<client>"` or `export ... from "<client>"`, by the
 * alias or a relative path ending in `supabase/client` (a bare `./client` is another module's own client, e.g. the Farah one, and no file beside supabase/client.ts imports it that way). A type-only import is erased at build time, so it is not a carrier. A dynamic `import("<client>")`
 * is the thing we want and is not matched.
 */
export function importsClientStatically(source: string): boolean {
  const spec = String.raw`["'](?:@/lib/supabase/client|(?:\.{1,2}/)+(?:lib/)?supabase/client)["']`;
  // `from "<client>"` after an import/export clause (not `import type`), or a bare side-effect `import "<client>"`.
  const clause = new RegExp(String.raw`(?:^|[;\n}])\s*(?:import(?!\s+type\b)|export(?!\s+type\b))[^;"']*?\bfrom\s*${spec}`, "m");
  const bare = new RegExp(String.raw`(?:^|[;\n}])\s*import\s*${spec}`, "m");
  return clause.test(source) || bare.test(source);
}

describe("the detector itself (so the ratchet is not vacuous)", () => {
  it("matches static imports by alias, relative path, multi-line, default, namespace and re-export", () => {
    expect(importsClientStatically('import { createClient } from "@/lib/supabase/client";')).toBe(true);
    expect(importsClientStatically("import { createClient } from '@/lib/supabase/client'")).toBe(true);
    expect(importsClientStatically('import {\n  createClient,\n} from "@/lib/supabase/client";')).toBe(true);
    expect(importsClientStatically('import * as c from "../../lib/supabase/client";')).toBe(true);
    expect(importsClientStatically('import "@/lib/supabase/client";')).toBe(true);
    expect(importsClientStatically('export { createClient } from "@/lib/supabase/client";')).toBe(true);
    expect(importsClientStatically('import a from "x";\nimport { createClient } from "@/lib/supabase/client";')).toBe(true);
  });
  it("does not match a dynamic import, a type-only import, a comment, or other modules", () => {
    expect(importsClientStatically('const { createClient } = await import("@/lib/supabase/client");')).toBe(false);
    expect(importsClientStatically('import type { createClient } from "@/lib/supabase/client";')).toBe(false);
    expect(importsClientStatically('// import { createClient } from "@/lib/supabase/client";')).toBe(false);
    expect(importsClientStatically('import { createClient } from "@/lib/supabase/server";')).toBe(false);
    expect(importsClientStatically('import { x } from "@/lib/supabase/client-helpers";')).toBe(false);
    expect(importsClientStatically('import { askFarah } from "./client";')).toBe(false);
  });
});

describe("no file under src/ imports the Supabase browser client statically", () => {
  const rel = (f: string) => f.replace(join(SRC, ".."), "").replace(/^\//, "");
  const all = files(SRC).filter((f) => rel(f) !== "src/lib/supabase/client.ts");

  it("outside the allowlist, every file loads it (if at all) by dynamic import", () => {
    const offenders = all.filter((f) => !ALLOWLIST.includes(rel(f)) && importsClientStatically(readFileSync(f, "utf8"))).map(rel);
    expect(offenders, "convert to a dynamic import (see src/lib/supabase/read-has-session.ts), do not add to the allowlist").toEqual([]);
  });

  it("every allowlist entry still imports it statically (a converted file must leave the list)", () => {
    const stale = ALLOWLIST.filter((f) => !importsClientStatically(readFileSync(join(SRC, "..", f), "utf8")));
    expect(stale).toEqual([]);
  });
});
