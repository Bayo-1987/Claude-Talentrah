import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PATH_HEADER, safeRedirectTo } from "@/lib/auth/redirect-to";
import { getAdminIdentity, type AdminIdentity, type AdminPermission } from "./session";

/**
 * The guard. Every page under /admin passes through it, via
 * src/app/admin/(protected)/layout.tsx.
 *
 * Deliberately NOT `requireUser()` and deliberately not a variant of it. That
 * one asks Supabase who the visitor is and looks up a `profiles` row; this one
 * never touches the seeker session at all. Sharing a helper between them would
 * mean a change made for the seeker app could widen the admin door, which is
 * precisely the coupling this milestone exists to avoid.
 *
 * The proxy (src/proxy.ts) also bounces /admin requests that carry no admin
 * cookie. That check is a cheap first pass, not the gate: it only proves a
 * cookie is PRESENT. This function is what proves it is valid, and a page that
 * skipped it would be unguarded no matter what the proxy did — which is why
 * the guard lives in a layout that wraps every protected page rather than
 * being called page by page.
 *
 * A VALID SESSION IS THE WHOLE TEST. There is no second factor: admin MFA was
 * built (0068) and then removed before any operator enrolled, deferred rather
 * than kept half-on. The consequence is written down rather than left to be
 * rediscovered — an admin's password is resettable through the seeker
 * forgot-password flow, so whoever holds the mailbox holds the admin account.
 * docs/admin-auth.md carries that as an accepted risk.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (!identity) redirect(`/admin/login${await returnTripSuffix()}`);
  return identity;
}

/**
 * The second gate: operator management, super admins only (0073).
 *
 * THIS IS THE BOUNDARY. Hiding the nav link from a standard admin is a
 * courtesy to them, not a control on them — a link they cannot see is still a
 * URL they can type, and the same reasoning is already written above about the
 * proxy's cookie check: a check that only proves something is PRESENT is not
 * the gate. Anything reachable only by super admins calls this, and calls it
 * on the server, in the page itself.
 *
 * It redirects rather than rendering a 403 page. A standard admin who lands
 * here has almost always followed a stale link or a bookmark, not probed for
 * something — and the dashboard is where they were going. The refusal is still
 * total; only its presentation is gentle.
 *
 * The DATABASE refuses this too: admin_update_operator (0073) re-checks that
 * the actor is an active super admin. That is not redundancy for its own sake
 * — it is what makes the function safe for any future caller that forgets to
 * come through here first.
 */
export async function requireSuperAdmin(): Promise<AdminIdentity> {
  return requirePermission("operators");
}

/**
 * The per-area gate (0075). One permission key, checked on the server.
 *
 * THIS IS THE CONTROL; the nav is not. A link a role does not grant is hidden
 * from that operator, but a hidden link is still a URL they can type — the
 * same distinction already written above about the proxy's cookie check, which
 * proves a cookie is PRESENT and nothing more. Every page that means to be
 * restricted calls this, in the page itself, because a page that forgot to is
 * open no matter what the nav shows.
 *
 * It redirects to /admin rather than rendering a 403. An operator who lands
 * somewhere they cannot go has almost always followed a stale link or a
 * bookmark; the dashboard is where they were going. The refusal is total —
 * only its presentation is gentle.
 *
 * WHAT THIS DOES NOT DO, stated so nobody assumes otherwise: for the eight
 * content areas it is enforced here and in each Server Action, both
 * server-side, but the DATABASE does not know about those permissions — their
 * actions write through the service-role client. Operator and role management
 * is different: admin_set_operator, admin_upsert_role and admin_delete_role
 * (0075) each re-check the actor themselves, because that is the surface that
 * can escalate privilege. Closing the gap for the other eight is tracked in
 * its own issue rather than left implied here.
 */
export async function requirePermission(permission: AdminPermission): Promise<AdminIdentity> {
  const identity = await requireAdmin();
  if (!identity.permissions.includes(permission)) redirect("/admin");
  return identity;
}

/** Non-redirecting form, for a page that renders differently rather than bouncing. */
export async function getAdmin(): Promise<AdminIdentity | null> {
  return getAdminIdentity();
}

/**
 * Same return-trip trick as require-user.ts, and the same refusal to trust it:
 * the path arrives in a header our own proxy sets, but the proxy does not strip
 * an incoming one, so it goes through `safeRedirectTo` before being echoed
 * back. See src/lib/auth/redirect-to.ts for why the "//" case is the one that
 * matters.
 */
async function returnTripSuffix(): Promise<string> {
  const here = safeRedirectTo((await headers()).get(PATH_HEADER), "");
  // Only ever come back to somewhere inside /admin. A ?redirectTo that walks
  // out of the admin area is not a return trip, it is a redirect the login
  // page has no business honouring.
  if (!here || !here.startsWith("/admin") || here.startsWith("/admin/login")) return "";
  return `?redirectTo=${encodeURIComponent(here)}`;
}
