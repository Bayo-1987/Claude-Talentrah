/**
 * Authenticated server-render timing, for before/after comparison.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * The production baseline for this work could only be taken from OUTSIDE
 * (curl against www.talentrah.com), and from outside there is no way to
 * reach /jobs, /tracker or /billing as a signed-in user — they answer 307 to
 * /login. Those three are exactly the pages the work is about, so the
 * before/after has to be taken somewhere a session can be minted.
 *
 * This mints one the same way e2e/fixtures/authed.ts does — admin-generated
 * magic link redeemed through @supabase/ssr, so the cookie's name and
 * encoding come from the library rather than from a guess here — and then
 * times plain HTTP requests against a LOCAL `next start`.
 *
 * ── WHAT THE NUMBERS ARE AND ARE NOT ──────────────────────────────────────
 *
 * They are local, against the CI Supabase project, on one machine. They are
 * NOT production numbers and must never be presented as such: production
 * runs in arn1 beside its own database, this runs on a laptop reaching
 * Stockholm over the public internet, so every database round trip here
 * costs far more than it does in production. That makes this a fair
 * BEFORE-AND-AFTER on identical conditions and a bad ABSOLUTE measure — the
 * ratio is the signal, not the milliseconds.
 *
 * Usage:  npx tsx scripts/measure-render.ts [runs]
 * Requires a server already listening on localhost:3000.
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE = process.env.MEASURE_BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.argv[2] ?? 12);

const ROUTES = ["/jobs", "/tracker", "/billing"];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function mintSessionCookies(): Promise<{ userId: string; cookie: string }> {
  const email = `perf-${randomUUID()}@${randomUUID().slice(0, 12)}.talentrah.test`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(`create user: ${error?.message}`);

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw new Error(`generate link: ${linkErr.message}`);

  const jar = new Map<string, string>();
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  const { error: otpErr } = await ssr.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw new Error(`verify otp: ${otpErr.message}`);
  if (jar.size === 0) throw new Error("no session cookie produced");

  const cookie = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
  return { userId: created.user.id, cookie };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

async function main() {
  const { userId, cookie } = await mintSessionCookies();
  console.log(`session for ${userId} against ${BASE}\n`);

  try {
    for (const route of ROUTES) {
      const timings: number[] = [];
      let status = 0;
      // One warm-up that is NOT recorded: the first hit of a route on a fresh
      // `next start` compiles and JIT-warms it, and folding that into a p50
      // would measure the server starting up rather than the page rendering.
      for (let i = 0; i <= RUNS; i++) {
        const t0 = performance.now();
        const res = await fetch(`${BASE}${route}`, {
          headers: { cookie },
          redirect: "manual",
        });
        await res.arrayBuffer();
        const ms = performance.now() - t0;
        status = res.status;
        if (i > 0) timings.push(ms);
      }
      timings.sort((a, b) => a - b);
      console.log(
        `${route.padEnd(10)} status=${status} ` +
          `p50=${percentile(timings, 50).toFixed(0)}ms ` +
          `p90=${percentile(timings, 90).toFixed(0)}ms ` +
          `min=${timings[0]!.toFixed(0)}ms ` +
          `max=${timings[timings.length - 1]!.toFixed(0)}ms ` +
          `n=${timings.length}`,
      );
    }
  } finally {
    // Always clean up, even if a route threw — otherwise a failed run leaves
    // an auth user behind in the shared CI project, which is exactly the
    // orphan-accumulation problem the e2e fixture had to solve.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`WARNING: could not delete ${userId}: ${error.message}`);
    else console.log(`\ncleaned up ${userId}`);
  }
}

void main();
