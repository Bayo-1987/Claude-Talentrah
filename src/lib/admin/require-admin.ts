import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PATH_HEADER, safeRedirectTo } from "@/lib/auth/redirect-to";
import { getAdminIdentity, type AdminIdentity } from "./session";

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
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (!identity) redirect(`/admin/login${await returnTripSuffix()}`);

  /*
   * ENROLMENT IS FORCED, LOGIN IS NOT BLOCKED.
   *
   * An operator without a second factor gets in and then goes exactly one
   * place: /admin/mfa. Refusing the login instead would have locked out every
   * admin that existed when this shipped — and since enrolment lives behind
   * this same guard, it would have been a deadlock escapable only by a
   * service-role intervention.
   *
   * The exemption is BY PATH and covers only the enrolment page itself. It is
   * deliberately not a list: every other admin route, present and future, is
   * gated by existing rather than by being remembered here.
   */
  if (!identity.mfaEnrolledAt && !(await onEnrolmentPage())) {
    redirect("/admin/mfa");
  }

  return identity;
}

/** Whether this request is already for the enrolment page. */
async function onEnrolmentPage(): Promise<boolean> {
  const here = (await headers()).get(PATH_HEADER) ?? "";
  return here === "/admin/mfa" || here.startsWith("/admin/mfa?");
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
