import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ADMIN_COOKIE, ADMIN_COOKIE_PATH } from "./cookie";

/**
 * The admin session — ours, not Supabase's.
 *
 * WHY NOT REUSE THE SEEKER SESSION. Supabase Auth checks the admin's password
 * exactly once, at /admin/login, using a client that is explicitly told not to
 * persist anything (see src/lib/admin/actions.ts). Nothing about that sign-in
 * reaches the browser. What the browser gets instead is the token below, and
 * the /admin guard reads only that.
 *
 * Three things follow from it, and they are the whole reason for the extra
 * table:
 *
 *   1. Being signed in to the seeker app grants nothing. A stolen `sb-*`
 *      cookie is not a way into /admin, because no admin code path calls
 *      `supabase.auth.getUser()`.
 *   2. An admin session is REVOCABLE from the database. Cutting off an
 *      operator is `update admin_sessions set revoked_at = now()`, or
 *      `update admin_users set disabled_at = now()` for all of their sessions
 *      at once — not a password reset and not a deploy.
 *   3. It expires on our schedule (8 hours), not Supabase's refresh-token
 *      schedule, which is tuned for a job seeker who should stay logged in for
 *      weeks.
 *
 * The cookie holds a 32-byte random token; the table holds only its SHA-256.
 * A dump of `admin_sessions` is therefore not a set of usable cookies. There
 * is no HMAC and no signing secret — the token carries no claims to protect,
 * it is a lookup key, and every decision about it is made by the database.
 */

export { ADMIN_COOKIE, ADMIN_COOKIE_PATH } from "./cookie";

/** 8 hours. Short because an idle admin tab is a standing set of privileges. */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * 0073's two fixed tiers. Retained only for the deprecated `admin_users.role`
 * column and the bridge function that still writes it; nothing in the app
 * decides anything from it any more.
 */
export type AdminRole = "super_admin" | "standard";

/** 0075. The catalog, one key per admin area plus the one that grants management. */
export type AdminPermission =
  | "scholarships"
  | "reported_postings"
  | "ad_campaigns"
  | "feedback"
  | "courses"
  | "operations"
  | "finance"
  | "people"
  | "operators";

export interface AdminIdentity {
  sessionId: string;
  adminId: string;
  email: string;
  displayName: string | null;
  expiresAt: string;
  /** 0073, deprecated by 0075. Kept until `admin_users.role` is dropped. */
  role: AdminRole;
  /** 0075. Null when this operator has no role assigned — which grants nothing. */
  roleId: string | null;
  roleName: string | null;
  /** Exactly what this operator may reach. Empty is a valid, deliberate answer. */
  permissions: AdminPermission[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Best-effort request provenance for the audit trail. Never trusted for auth. */
async function requestContext(): Promise<{ userAgent: string | null; ip: string | null }> {
  const h = await headers();
  // x-forwarded-for is a client-settable header that a proxy appends to. The
  // left-most entry is the one Vercel prepends, and it is recorded as a hint
  // for an operator reading the log — nothing authorises on it.
  const forwarded = h.get("x-forwarded-for");
  return {
    userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
    ip: forwarded?.split(",")[0]?.trim() || null,
  };
}

/**
 * Issues a session for an admin who has just proved their password, and sets
 * the cookie. Returns the new session id so the caller can attribute the login
 * itself.
 */
export async function createAdminSession(adminId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const { userAgent, ip } = await requestContext();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("admin_sessions")
    .insert({
      admin_user_id: adminId,
      token_hash: hashToken(token),
      expires_at: expiresAt.toISOString(),
      user_agent: userAgent,
      ip,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not open an admin session: ${error?.message ?? "no row returned"}`);
  }

  await supabase
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", adminId);

  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: ADMIN_COOKIE_PATH,
    maxAge: SESSION_TTL_SECONDS,
  });

  return data.id;
}

/**
 * Who, if anyone, this request is. Returns null for every failure — unknown
 * token, revoked, expired, disabled admin — because the caller has no
 * legitimate use for the difference and a page that distinguishes them tells
 * an attacker which token was real.
 *
 * The check is ONE statement (`admin_session_validate`, 0060): the four
 * conditions and the last-seen stamp move together under one lock. A SELECT
 * followed by an UPDATE here would be the same read-then-act shape that let
 * `spendCredits` double-spend before 0035.
 */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("admin_session_validate", {
    p_token_hash: hashToken(token),
  });

  if (error) {
    // A failure to VALIDATE is not a failure to authenticate — it is us being
    // broken. Log it loudly and refuse anyway; the alternative is an admin
    // area that opens when the database hiccups.
    console.error("[admin-session] validate failed", error);
    return null;
  }

  const row = data?.[0];
  if (!row) return null;

  /*
   * A second read rather than a change to admin_session_validate's signature.
   * That function is the gate — four conditions under one lock — and widening
   * its return type means re-applying a migration that is already live on both
   * projects, to carry a field the gate does not use. The role is not an
   * authentication decision; it decides which pages an ALREADY-VALIDATED
   * operator may reach.
   *
   * (This is the same enrichment-read shape 0068 used for mfa_enrolled_at. It
   * was removed wholesale with that feature in 0071, so this reintroduces the
   * pattern rather than editing a surviving one.)
   *
   * FAILING CLOSED IS THE POINT OF THE COALESCE. A missing row or a failed
   * read yields "standard", the role that can do less. The alternative —
   * defaulting to super_admin, or throwing — either widens access on a
   * database hiccup or takes the whole dashboard down over a page that most
   * operators never open.
   */
  const { data: enrichment, error: roleError } = await supabase
    .from("admin_users")
    .select("role, role_id")
    .eq("id", row.admin_id)
    .maybeSingle();
  if (roleError) console.error("[admin-session] role read failed", roleError);

  /*
   * NO ROLE MEANS NO PERMISSIONS, and that is the designed failure. 0075 left
   * `role_id` nullable rather than defaulting it to Standard Admin: an
   * operator who can sign in and reach nothing is a visible, fixable mistake,
   * whereas one silently handed eight permissions is not. The same reasoning
   * makes every read below fail closed — a failed query yields an empty set,
   * never a full one.
   */
  let roleName: string | null = null;
  let permissions: AdminPermission[] = [];

  if (enrichment?.role_id) {
    const [{ data: roleRow }, { data: permRows, error: permError }] = await Promise.all([
      supabase.from("admin_roles").select("name").eq("id", enrichment.role_id).maybeSingle(),
      supabase.from("admin_role_permissions").select("permission").eq("role_id", enrichment.role_id),
    ]);
    if (permError) console.error("[admin-session] permission read failed", permError);
    roleName = roleRow?.name ?? null;
    permissions = (permRows ?? []).map((r) => r.permission);
  }

  return {
    sessionId: row.session_id,
    adminId: row.admin_id,
    email: row.admin_email,
    displayName: row.admin_display_name ?? null,
    expiresAt: row.session_expires_at,
    role: enrichment?.role === "super_admin" ? "super_admin" : "standard",
    roleId: enrichment?.role_id ?? null,
    roleName,
    permissions,
  };
}

/**
 * Ends the current session everywhere it exists — the row is revoked before
 * the cookie is cleared, so a copy of the cookie taken beforehand is dead too.
 * Clearing the cookie alone would log out the browser and leave the token
 * valid.
 */
export async function revokeCurrentAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;

  if (token) {
    const supabase = createServiceRoleClient();
    const { error } = await supabase
      .from("admin_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", hashToken(token))
      .is("revoked_at", null);
    // A rejected Supabase write resolves with an `error` rather than throwing
    // (see CLAUDE.md). An unchecked revoke would report a sign-out that never
    // happened.
    if (error) console.error("[admin-session] revoke failed", error);
  }

  store.delete({ name: ADMIN_COOKIE, path: ADMIN_COOKIE_PATH });
}
