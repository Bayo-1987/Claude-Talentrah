import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * One auth check for every admin/cron route.
 *
 * ── What was wrong, and why the inconsistency was the bug ─────────────────
 *
 * Five admin routes each rolled their own guard, and they disagreed in three
 * ways at once:
 *
 *   * FAIL-OPEN. `if (secret) { ...check... }` skips the check entirely when
 *     the variable is unset. Convenient locally; in production it means a
 *     missing env var silently publishes the job-ingestion trigger, the
 *     LLM-cost estimator (which spends real budget per call) and the
 *     scholarship moderation control to the internet.
 *
 *     This was not hypothetical. Against the live deployment, before the fix:
 *
 *       $ curl https://claude-talentrah.vercel.app/api/admin/moderate-scholarship
 *         # retired since — see the note under this transcript
 *       {"count":3,"scholarships":[{"id":"812ce263-…","provider":"Petroleum
 *        Technology Development Fund (PTDF)",…,"moderation_status":"pending"}…
 *       HTTP 200
 *
 *       $ curl -X POST '…/api/admin/estimate-llm-costs?group=bogus'
 *       {"error":"group must be one of tailoring, bullet, scholarship"}
 *       HTTP 400      # 400 not 401 — the guard was skipped, only the
 *                     # argument validation behind it answered
 *
 *     The moderate-scholarship route above no longer exists: /admin/scholarships
 *     replaced it with a session-authenticated Server Action. The transcript is
 *     kept because it is the EVIDENCE for the rule, not a URL to go and try.
 *     This guard is unchanged and still correct for the callers that have no
 *     session to present — the cron routes and estimate-llm-costs.
 *
 *     INGEST_SECRET is not set on the deployment, so every route gated on it
 *     has been open since it shipped — including the POST that flips a
 *     scholarship to `verified` and publishes it to the catalog.
 *
 *   * THREE env vars for equivalent things. `INGEST_SECRET` covered four
 *     routes; `PASS_RENEWAL_SECRET` covered exactly one — the POST path of
 *     /api/admin/renew-passes, which triggers real Paystack charges. An
 *     operator who set the documented `INGEST_SECRET` had every reason to
 *     believe the admin surface was secured. The one route that spends money
 *     was the one gated on a variable nothing else used.
 *
 *   * NON-TIMING-SAFE comparison. Every one used `!==`. The Paystack webhook
 *     route next door already does this correctly with `timingSafeEqual`; the
 *     routes that gate spend did not.
 *
 * ── The shape now ─────────────────────────────────────────────────────────
 *
 * Fail closed, always. No secret configured means every admin route answers
 * 401 — including locally, which is deliberate: "works on my machine because
 * the guard is off" is exactly how the production gap survived.
 *
 * `INGEST_SECRET` stays the canonical variable rather than inventing a new
 * name, because it is already documented in .env.example. `ADMIN_API_SECRET`
 * is accepted first if present, so a rename can happen later without a flag
 * day. All three historical header names are accepted so existing runbooks
 * keep working; `x-admin-secret` is the name to use going forward.
 */

const ADMIN_HEADERS = ["x-admin-secret", "x-ingest-secret", "x-renewal-secret"] as const;

/** Constant-time compare that doesn't leak the expected length by returning early. */
function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // timingSafeEqual throws on a length mismatch. Do an equivalent-cost
    // comparison anyway so the reject path isn't measurably faster.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function adminSecret(): string | undefined {
  return process.env.ADMIN_API_SECRET || process.env.INGEST_SECRET || undefined;
}

/**
 * Guards a manual/admin trigger. Returns a 401 response to hand back as-is, or
 * `null` when the caller is authorised.
 */
export function requireAdminSecret(request: Request): NextResponse | null {
  const expected = adminSecret();

  if (!expected) {
    console.error(
      "[admin-auth] refused: no ADMIN_API_SECRET/INGEST_SECRET configured. Admin routes stay closed until one is set.",
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  for (const header of ADMIN_HEADERS) {
    if (secretsMatch(request.headers.get(header), expected)) return null;
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Guards a Vercel Cron GET.
 *
 * Separate from the above because the header and env var are both fixed by
 * Vercel and not configurable: it sends `Authorization: Bearer <CRON_SECRET>`.
 * This path was already fail-closed on the two routes that had it; the
 * comparison is now timing-safe too, and identical everywhere instead of
 * copy-pasted per route.
 */
export function requireCronSecret(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[admin-auth] refused: CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const header = request.headers.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return secretsMatch(provided, expected)
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * The one error body every route returns for an unexpected exception.
 *
 * Four handlers returned `err.message` straight from a caught exception, which
 * can carry raw Postgres/driver detail — table names, column names, constraint
 * names — to a caller who, per the finding above, was not even authenticated.
 * Two other handlers already refused to do that and said why in a comment.
 * Nothing decided which behaviour shipped; now there is one answer.
 *
 * The detail is not lost, it moves to the server log where it belongs.
 */
export function internalError(context: string, err: unknown): NextResponse {
  console.error(`[${context}]`, err);
  return NextResponse.json(
    { error: "Something went wrong on our end. Try again shortly." },
    { status: 500 },
  );
}
