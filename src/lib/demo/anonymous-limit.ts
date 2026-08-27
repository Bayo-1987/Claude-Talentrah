import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Who gets the one free pre-signup run, and how many happen in a day.
 *
 * The counting is all in Postgres (0058) because it has to be atomic — see
 * that migration for why each of the two limits serialises differently. This
 * module's job is the part Postgres cannot do: turning a request into an
 * identifier without ever storing the address it came from.
 */

/** Global ceiling across every anonymous visitor. Sized in 0058's comment. */
export const ANON_DEMO_DAILY_CAP = 5;

export const VISITOR_COOKIE = "trh_demo_visitor";
/** A year. The cap is a lifetime one; the cookie should outlive a job search. */
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type ClaimReason = "ok" | "already_used" | "daily_cap" | "no_identifier" | "error";

export interface ClaimResult {
  allowed: boolean;
  reason: ClaimReason;
}

/**
 * An HMAC of the caller's IP, or null.
 *
 * NULL IS A REAL ANSWER, not a failure to handle later. Two ways to get it:
 *
 *   No `ANON_DEMO_IP_SALT` configured. The IP dimension is then skipped
 *   entirely and the cookie carries the limit alone. That is a deliberate
 *   choice over the alternative — an unkeyed digest — because IPv4 is 2^32
 *   values and a plain SHA-256 of one is reversible by brute force in
 *   minutes. A weak hash of every visitor's address is worse than not
 *   recording the address, and "the demo is slightly easier to abuse" is a
 *   smaller harm than "we kept a reversible log of who visited". Logged at
 *   warn so an unset variable is visible rather than silent.
 *
 *   No usable address on the request. Behind Vercel there always is one, but
 *   this must not throw in a local or proxied context where there is not.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;

  const salt = process.env.ANON_DEMO_IP_SALT;
  if (!salt) {
    console.warn(
      "[anon-demo] ANON_DEMO_IP_SALT is not set — the free-run limit is cookie-only for this request. " +
        "Not falling back to an unkeyed hash: IPv4 is small enough to brute-force, so that would be a " +
        "reversible record of visitors' addresses.",
    );
    return null;
  }

  return createHmac("sha256", salt).update(ip).digest("hex");
}

/**
 * The client address, from the proxy headers Vercel sets.
 *
 * `x-forwarded-for` is a comma-separated chain and only its FIRST entry is the
 * original client; taking the last would be the proxy itself, which is the
 * same value for every visitor and would cap the whole internet at one run.
 * The header is client-controllable in principle — anyone can send whatever
 * they like — which is precisely why it is not the only limit and why the
 * daily ceiling exists independently of it.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

/** A new opaque id for a visitor with no cookie yet. */
export function newVisitorId(): string {
  return randomUUID();
}

/** Only accept a cookie value that is actually a uuid — it reaches SQL as one. */
export function parseVisitorId(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

export async function claimAnonymousRun(
  ipHash: string | null,
  visitorId: string | null,
): Promise<ClaimResult> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("claim_anonymous_demo_run", {
    /*
     * Both are nullable in SQL and both are genuinely null in normal
     * operation — no salt configured, or no cookie yet. Typegen renders a
     * parameter without a DEFAULT as non-optional and non-nullable, which
     * over-narrows it; same cast and same reason as the p_reviewer_id note in
     * /api/admin/moderate-campaign.
     */
    p_ip_hash: ipHash as unknown as string,
    p_visitor_id: visitorId as unknown as string,
    p_daily_cap: ANON_DEMO_DAILY_CAP,
  });

  if (error) {
    /*
     * Fail CLOSED, the same way consumeRateLimit does. A counter that cannot
     * be read is not evidence of headroom, and the failure most likely to
     * coincide with heavy load is exactly the one that must not open the gate
     * to a shared, metered model key.
     */
    console.error("[anon-demo] claim failed, denying:", error);
    return { allowed: false, reason: "error" };
  }

  const row = data?.[0];
  if (!row) return { allowed: false, reason: "error" };
  return { allowed: row.allowed, reason: row.reason as ClaimReason };
}

/**
 * Hand the run back after a failure the visitor did not cause.
 *
 * Best-effort and non-throwing: this is called from an error path, and a
 * failure to release must not replace the real error the caller is about to
 * report. It is logged, though — a release that silently stopped working
 * would burn one visitor's only attempt per outage, which is the kind of thing
 * that shows up much later as "the demo never works".
 */
export async function releaseAnonymousRun(
  ipHash: string | null,
  visitorId: string | null,
): Promise<void> {
  const admin = createServiceRoleClient();
  const { error } = await admin.rpc("release_anonymous_demo_run", {
    // Nullable in SQL; see the note in claimAnonymousRun.
    p_ip_hash: ipHash as unknown as string,
    p_visitor_id: visitorId as unknown as string,
  });
  if (error) console.error("[anon-demo] release failed — a free run was consumed by our error:", error);
}
