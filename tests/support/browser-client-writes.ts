/**
 * Pure functions (no database) that read SOURCE TEXT and report every place the browser Supabase client could write.
 *
 * The browser client (src/lib/supabase/client.ts) is built with the public anon key. Whatever a visitor's browser can send with it, a visitor can send by hand, so the privileges anon and authenticated
 * hold are the real boundary for it. This app has no reason to write from the browser: every write goes through a Server Action, a route handler or the service role, and those can check who is asking. A write
 * from the browser client would be the one write path with nothing between the visitor and the table but a row policy, so the standing rule is that there are none.
 *
 * What counts as a write: a `.from(...)` chain that reaches `.insert(`, `.update(`, `.upsert(`, `.delete(` (or a storage `.upload(` / `.remove(`), and any `.rpc(` (a function can write; use a Server Action).
 * `.delete(` on a Map or a URLSearchParams is not a table write, so the verbs only count when they follow a `.from(` in the same statement.
 */
export type WriteFinding = { file: string; line: number; reason: string; snippet: string };

const WRITE_VERBS = ["insert", "update", "upsert", "delete", "upload", "remove"] as const;

/** True when the file builds a Supabase client in the browser: the app's own browser client module (imported statically or dynamically), or createBrowserClient used directly. */
export function usesBrowserClient(source: string): boolean {
  return (
    /from\s+["'](?:@\/lib\/supabase\/client|(?:\.{1,2}\/)+(?:lib\/)?supabase\/client|\.\/client)["']/.test(source) ||
    // The same module loaded without a static import: `await import("...")` (the app does this on purpose to keep the client out of a route's static chunk list) or `require("...")`.
    /\b(?:import|require)\(\s*["'](?:@\/lib\/supabase\/client|(?:\.{1,2}\/)+(?:lib\/)?supabase\/client|\.\/client)["']\s*\)/.test(source) ||
    /\bcreateBrowserClient\b/.test(source)
  );
}

/** True when the source text takes a Supabase client as a value (a helper that a component hands the browser client to). */
export function acceptsSupabaseClient(source: string): boolean {
  return /\bSupabaseClient\b/.test(source);
}

/** A statement ends at the first `;` or blank line after the chain starts. This is a text scan, so it errs on the side of flagging. */
function chainAfter(source: string, from: number): string {
  const rest = source.slice(from, from + 1200);
  const stop = rest.search(/;|\n\s*\n/);
  return stop === -1 ? rest : rest.slice(0, stop);
}

/** Every browser-client write in `source`, as findings. Returns [] for a file that is not a browser-client file and not a helper that takes the client. */
export function browserWriteFindings(file: string, source: string, opts: { helper?: boolean } = {}): WriteFinding[] {
  if (!opts.helper && !usesBrowserClient(source)) return [];
  const findings: WriteFinding[] = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;
  for (const m of source.matchAll(/\.from\(/g)) {
    const chain = chainAfter(source, m.index ?? 0);
    for (const verb of WRITE_VERBS) {
      if (new RegExp(`\\.${verb}\\(`).test(chain)) {
        findings.push({ file, line: lineOf(m.index ?? 0), reason: `.from(...).${verb}( from the browser client`, snippet: chain.replace(/\s+/g, " ").slice(0, 120) });
      }
    }
  }
  for (const m of source.matchAll(/\.rpc\(/g)) {
    findings.push({ file, line: lineOf(m.index ?? 0), reason: ".rpc( from the browser client (a function can write; use a Server Action)", snippet: source.slice(m.index ?? 0, (m.index ?? 0) + 100).replace(/\s+/g, " ") });
  }
  return findings;
}

/** The files that name the public anon key. A new one is a new way to build an anon-key client, so it has to be looked at (does it write?) and added to the list on purpose. */
export const ANON_KEY_FILES_REVIEWED = [
  "src/app/auth/callback/route.ts",
  // Reviewed 16 Oct 2026: a session client (createServerClient); reads profiles.country with .select() and writes only through auth.updateUser; no .from(...).insert/update/upsert/delete, no .rpc.
  "src/app/welcome/country/sync/route.ts",
  "src/lib/admin/actions.ts",
  "src/lib/blog/scholarship-embed.ts",
  "src/lib/supabase/client.ts",
  "src/lib/supabase/middleware.ts",
  "src/lib/supabase/public-read.ts",
  "src/lib/supabase/server.ts",
  "src/proxy.ts",
] as const;
