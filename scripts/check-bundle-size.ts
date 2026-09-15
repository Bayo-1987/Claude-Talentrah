/**
 * Bundle-size regression tripwire for the three routes CLAUDE.md's
 * non-functional requirements call out as load-bearing: the target market
 * skews low-end Android + expensive mobile data, so a client-JS regression
 * on the landing page, the job feed, or the tailoring flow is a real product
 * cost, not just an aesthetic one. Nothing about the current dependency tree
 * is broken today (heavy parsers are behind `server-only`, icons are
 * tree-shaken, raw `<img>` usage is deliberate) — this exists so a FUTURE
 * regression fails CI before it ships, not so today's build hits zero.
 *
 * ── WHY THIS DOESN'T READ NEXT'S OWN BUILD-OUTPUT TABLE ──────────────────
 *
 * `next build` under Turbopack (the default as of Next 16 in this repo) no
 * longer prints the classic per-route "First Load JS" column — checked
 * directly (`npm run build`, `npm run build -- --debug`,
 * `next build --experimental-analyze`), not assumed: none of them emit a
 * size table any more, only a Revalidate/Expire column. The `--experimental-
 * analyze` flag does write a machine-readable dump under
 * `.next/diagnostics/analyze/`, but that format is explicitly experimental
 * and undocumented, which makes it a bad foundation for a check meant to
 * stay correct across Next upgrades.
 *
 * Instead this measures the thing a real browser actually downloads: start
 * the production server, request each route over real HTTP (with a real
 * signed-in session for the two gated routes — `/jobs` and `/tailor` both
 * 307 to /login otherwise), parse the `<script src>` tags Next actually
 * injected into that response, and sum the JS those tags point at. That is
 * exactly the "First Load JS" definition (shared runtime + framework chunks
 * + the page's own chunk, hydration-critical), it works whether the
 * underlying bundler is Turbopack or webpack, and it can't silently start
 * measuring the wrong thing if Next's internal manifest format changes
 * shape again.
 *
 * `noModule` scripts (the legacy-browser polyfill chunk) are deliberately
 * excluded — real modern-browser traffic never downloads them, so counting
 * them would inflate every route by the same fixed amount and mask a real
 * per-route regression.
 *
 * Sizes are reported two ways: raw bytes as served, and gzip bytes computed
 * locally with zlib. The gzip figure is what's compared against budget,
 * because it approximates real network transfer size and is what Next's own
 * historical build table reported — `next start` itself does not compress
 * responses (that happens at Vercel's edge in production), so reading
 * Content-Length off the wire here would measure something neither this
 * script's own transfer nor production's real transfer.
 *
 * ── HOW THE AUTH-GATED ROUTES ARE REACHED ─────────────────────────────────
 *
 * Same technique as e2e/fixtures/authed.ts and scripts/measure-render.ts:
 * create a throwaway user with the service role, mint a magic link, redeem
 * it through @supabase/ssr to get the exact session cookie the app expects,
 * and delete the user again in a `finally`. Not shared code with those two
 * files — measure-render.ts already made the same call (a small, well-
 * understood pattern duplicated three times is cheaper than a shared module
 * three call sites have to agree on).
 *
 * ── USAGE ──────────────────────────────────────────────────────────────
 *
 *   npm run build && npm run start &
 *   npx tsx scripts/check-bundle-size.ts
 *
 * Requires a production server already listening (BUNDLE_CHECK_BASE_URL,
 * default http://localhost:3000) and NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the
 * environment (CI's local-supabase action exports these; a developer's
 * .env.local already has them for dozaffzgqkbarxtlclsj).
 */
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const BASE = process.env.BUNDLE_CHECK_BASE_URL ?? "http://localhost:3000";

/**
 * ── BUDGETS (gzip KB, First-Load JS for a signed-out/first-time visit) ───
 *
 * Measured against this repo's real production build on 2026-09-14
 * (`npm run build` on Next 16.3.5/Turbopack, then this script against
 * `npm run start`, run twice to confirm the numbers are stable rather than
 * a one-off fluke):
 *
 *   route     gzip KB measured   budget   headroom
 *   /              206.2 KB       275      ~33%
 *   /jobs          279.5 KB       365      ~31%
 *   /tailor        216.5 KB       285      ~32%
 *
 * Headroom is deliberately ~30%, not tight-to-the-measurement: this check
 * exists to catch a real regression (a duplicated heavy dependency, an
 * accidentally-unshaken import), not to fail on the normal week-to-week
 * drift of adding a genuine small feature. If a legitimate change pushes a
 * route over budget, raise the number for THAT route deliberately — re-run
 * this script against the new build, note the new measurement and date in
 * this comment the same way, and widen headroom by the same ~30% logic
 * rather than just matching the new number exactly (which would leave zero
 * slack for the next change).
 */
const ROUTES: { path: string; budgetGzipKB: number; requiresAuth: boolean }[] = [
  { path: "/", budgetGzipKB: 275, requiresAuth: false },
  { path: "/jobs", budgetGzipKB: 365, requiresAuth: true },
  { path: "/tailor", budgetGzipKB: 285, requiresAuth: true },
];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function mintSessionCookie(): Promise<{ userId: string; cookie: string }> {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY " +
        "must be set to check an auth-gated route.",
    );
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const email = `bundle-check-${randomUUID()}@${randomUUID().slice(0, 12)}.talentrah.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`create user: ${createErr?.message}`);

  try {
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
  } catch (err) {
    // Same guard as e2e/fixtures/authed.ts: don't orphan a user if minting
    // the session fails partway through.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw err;
  }
}

async function deleteUser(userId: string): Promise<void> {
  const admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Checked, per this repo's own standing rule: a rejected Supabase delete
  // resolves with an `error` rather than throwing, so an unchecked delete
  // here would silently leave throwaway users behind on every run.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error(`WARNING: could not delete throwaway user ${userId}: ${error.message}`);
}

/** Extracts same-origin, module (non-legacy) script chunk URLs from HTML. */
function extractScriptUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  const scriptTagRe = /<script\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptTagRe.exec(html))) {
    const attrs = match[1];
    if (/\bnoModule\b/i.test(attrs)) continue; // legacy-browser polyfill chunk
    const srcMatch = /\bsrc="([^"]+)"/i.exec(attrs);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (!src.startsWith("/_next/static/")) continue;
    urls.add(new URL(src, base).toString());
  }
  return [...urls];
}

async function measureRoute(
  routePath: string,
  cookie: string | undefined,
): Promise<{ rawBytes: number; gzipBytes: number; scriptCount: number; status: number }> {
  const res = await fetch(`${BASE}${routePath}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const html = await res.text();
  if (res.status !== 200) {
    throw new Error(
      `${routePath} responded ${res.status}, expected 200 (a 307 usually means the session cookie ` +
        `wasn't accepted, or the route now requires something this script doesn't set up).`,
    );
  }

  const scriptUrls = extractScriptUrls(html, BASE);
  if (scriptUrls.length === 0) {
    throw new Error(`${routePath}: found zero client script tags — the parser or the page markup changed.`);
  }

  let rawBytes = 0;
  let gzipBytes = 0;
  for (const url of scriptUrls) {
    const assetRes = await fetch(url, { headers: cookie ? { cookie } : {} });
    if (!assetRes.ok) {
      throw new Error(`${routePath}: failed to fetch referenced script ${url} (${assetRes.status})`);
    }
    const buf = Buffer.from(await assetRes.arrayBuffer());
    rawBytes += buf.byteLength;
    gzipBytes += gzipSync(buf, { level: 9 }).byteLength;
  }

  return { rawBytes, gzipBytes, scriptCount: scriptUrls.length, status: res.status };
}

async function main() {
  console.log(`Bundle-size check against ${BASE}\n`);

  let authCookie: string | undefined;
  let authUserId: string | undefined;
  const needsAuth = ROUTES.some((r) => r.requiresAuth);
  if (needsAuth) {
    const minted = await mintSessionCookie();
    authCookie = minted.cookie;
    authUserId = minted.userId;
  }

  const results: {
    path: string;
    rawKB: number;
    gzipKB: number;
    budgetKB: number;
    scriptCount: number;
    ok: boolean;
  }[] = [];

  try {
    for (const route of ROUTES) {
      const { rawBytes, gzipBytes, scriptCount } = await measureRoute(
        route.path,
        route.requiresAuth ? authCookie : undefined,
      );
      const rawKB = rawBytes / 1024;
      const gzipKB = gzipBytes / 1024;
      results.push({
        path: route.path,
        rawKB,
        gzipKB,
        budgetKB: route.budgetGzipKB,
        scriptCount,
        ok: gzipKB <= route.budgetGzipKB,
      });
    }
  } finally {
    if (authUserId) await deleteUser(authUserId);
  }

  const header = `${"Route".padEnd(10)} ${"Scripts".padStart(7)} ${"Raw KB".padStart(9)} ${"Gzip KB".padStart(9)} ${"Budget".padStart(8)}  Result`;
  console.log(header);
  console.log("-".repeat(header.length));
  let anyFailed = false;
  for (const r of results) {
    if (!r.ok) anyFailed = true;
    console.log(
      `${r.path.padEnd(10)} ${String(r.scriptCount).padStart(7)} ${r.rawKB.toFixed(1).padStart(9)} ${r.gzipKB
        .toFixed(1)
        .padStart(9)} ${String(r.budgetKB).padStart(8)}  ${r.ok ? "PASS" : "FAIL — over budget"}`,
    );
  }
  console.log();

  if (anyFailed) {
    console.error(
      "One or more routes exceeded their client-JS size budget. See scripts/check-bundle-size.ts " +
        "for how these budgets were set and how to raise one deliberately.",
    );
    process.exit(1);
  }

  console.log("All routes within budget.");
}

void main();
