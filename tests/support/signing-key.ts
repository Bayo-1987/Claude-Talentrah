/**
 * ENV-SKIP-1. Some suites mint a user session by signing a token with the project's JWT secret (tests/support/auth.ts sessionFor). With no secret, or one the project rejects (a local or preview
 * database whose key is not the one in the environment), those suites used to FAIL deep inside a hook with a confusing message. They now skip with a clear reason; CI's ephemeral database has the
 * right key and keeps running them.
 *
 * This NEVER looks for, reads from anywhere else, copies or prints a key: it only checks whether the one in the environment is set and whether the project accepts it.
 *
 *   const keyProblem = await signingKeyProblem();
 *   describe.skipIf(keyProblem !== null)("…", …);   // and, for a visible reason in the report:
 *   if (keyProblem) it.skip(`SKIPPED: ${keyProblem}`, () => {});
 */
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export const SIGNING_KEY_SKIP_REASON = "requires SUPABASE_JWT_SECRET valid for this project";

export interface ProbeResult {
  status: number;
  body?: string;
}

/** Pure decision, so it can be tested with a fake probe. Returns the skip reason, or null when the key is fine (or when the project simply cannot be reached: that is a different problem). */
export async function evaluateSigningKey(opts: { secret: string | undefined; probe: (secret: string) => Promise<ProbeResult> }): Promise<string | null> {
  if (!opts.secret) return `${SIGNING_KEY_SKIP_REASON} (SUPABASE_JWT_SECRET is not set)`;
  let result: ProbeResult;
  try {
    result = await opts.probe(opts.secret);
  } catch {
    return null; // unreachable project: not a key problem, let the real error show
  }
  if (result.status === 401 || /PGRST301/.test(result.body ?? "")) {
    return `${SIGNING_KEY_SKIP_REASON} (the project rejected the key in SUPABASE_JWT_SECRET)`;
  }
  return null;
}

let cached: Promise<string | null> | undefined;

/** Does the project at NEXT_PUBLIC_SUPABASE_URL accept a token signed with SUPABASE_JWT_SECRET? Cached per test file. */
export function signingKeyProblem(): Promise<string | null> {
  cached ??= evaluateSigningKey({
    secret: process.env.SUPABASE_JWT_SECRET,
    probe: async (secret) => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) throw new Error("no project configured");
      const now = Math.floor(Date.now() / 1000);
      const token = jwt.sign({ sub: randomUUID(), role: "authenticated", aud: "authenticated", iat: now, exp: now + 300 }, secret, { algorithm: "HS256" });
      const res = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      return { status: res.status, body: res.status >= 400 ? await res.text() : undefined };
    },
  });
  return cached;
}
