"use server";

import { createClient as createStandaloneClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { safeRedirectTo } from "@/lib/auth/redirect-to";
import type { Database } from "@/lib/supabase/types";
import { adminLoginSchema } from "./schemas";
import type { AdminLoginState } from "./login-state";
import { createAdminSession, getAdminIdentity, revokeCurrentAdminSession } from "./session";
import { recordAdminAction, recordFailedAdminLogin } from "./audit";

/**
 * One message for every rejection, on purpose.
 *
 * Wrong password, correct password but not an admin, correct password on a
 * disabled admin, malformed email — all of them say this. A form that
 * distinguishes them tells whoever is guessing which half they got right, and
 * "this address is one of the operators" is the more valuable half.
 *
 * That matters more here than it would with a second factor in front of it.
 * Password is the only thing being checked, so the reply to a wrong one is the
 * only signal available — and it says nothing.
 */
const GENERIC_FAILURE = "Incorrect email or password.";

/**
 * Verifies a password against Supabase Auth WITHOUT creating a Supabase
 * session.
 *
 * This is the line between the two systems. `createClient()` from
 * src/lib/supabase/server.ts writes `sb-*` cookies; using it here would mean
 * logging in at /admin/login also signs the operator into the seeker app, and
 * — much worse — that a seeker session cookie would start to look like
 * something the admin area could trust. This client persists nothing: the
 * session it mints is discarded the moment the password is confirmed, and the
 * only thing that survives the call is the user id.
 */
function passwordCheckClient() {
  return createStandaloneClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export async function adminLoginAction(
  _prev: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: GENERIC_FAILURE };

  const { email, password } = parsed.data;

  /*
   * Password first, admin-membership second, and never the other way round.
   * Checking `admin_users` before the password would let anyone learn which
   * addresses are operators by timing the two paths.
   *
   * WHAT PROTECTS THIS FROM GUESSING, stated honestly. Supabase rate-limits
   * its token endpoint per source IP — but this call is made from the server,
   * so the source IP is ours and the limit is shared by everyone who logs in.
   * It is a ceiling on total attempts, not a per-attacker one. The seeker
   * login (src/lib/auth/actions.ts) has had exactly this property since it
   * shipped, so this is not a new exposure, and a second limiter keyed on the
   * caller's own IP would be the real fix. `api_rate_limits` (0038) is where
   * that belongs; it is not in M1's scope and is written down in
   * docs/admin-auth.md rather than assumed to be handled.
   */
  const { data: signIn, error: signInError } = await passwordCheckClient()
    .auth.signInWithPassword({ email, password });

  const supabase = createServiceRoleClient();

  if (signInError || !signIn.user) {
    // A wrong password against a REAL operator's address is the only failure
    // worth keeping. See recordFailedAdminLogin for why the others are not.
    // Lower-cased, not `ilike`. `admin_users` is unique on lower(email) and
    // scripts/grant-admin.ts stores the address already folded, so an equality
    // match is exact — and it keeps a submitted "%@%" from being read as a
    // LIKE pattern that matches every operator at once.
    const { data: known } = await supabase
      .from("admin_users")
      .select("id, email")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (known) await recordFailedAdminLogin(known.id, known.email);
    return { error: GENERIC_FAILURE };
  }

  const { data: adminUser, error: lookupError } = await supabase
    .from("admin_users")
    .select("id, email, disabled_at")
    .eq("id", signIn.user.id)
    .maybeSingle();

  if (lookupError) {
    console.error("[admin-login] admin_users lookup failed", lookupError);
    return { error: "Something went wrong on our end. Try again shortly." };
  }

  // Not an admin, or no longer one. A perfectly valid seeker password lands
  // here and gets the same sentence as a typo.
  if (!adminUser || adminUser.disabled_at) {
    if (adminUser) await recordFailedAdminLogin(adminUser.id, adminUser.email);
    return { error: GENERIC_FAILURE };
  }

  /*
   * THERE IS NO SECOND FACTOR. A correct password on a live admin_users row is
   * the whole test. MFA was built (0068) and removed before anyone enrolled;
   * see docs/admin-auth.md for why that risk is accepted rather than missed.
   */
  let sessionId: string;
  try {
    sessionId = await createAdminSession(adminUser.id);
  } catch (err) {
    console.error("[admin-login] could not open session", err);
    return { error: "Something went wrong on our end. Try again shortly." };
  }

  await recordAdminAction({
    identity: { adminId: adminUser.id, email: adminUser.email, sessionId },
    action: "admin.login",
  });

  /*
   * Validated here as well as on the page that rendered the hidden field,
   * because this reads a form value and a form can be posted by anything. The
   * extra `/admin` constraint is this surface's own: the admin login page has
   * no business bouncing anyone into the seeker app, so a redirectTo that
   * leaves /admin falls back to the dashboard rather than being honoured.
   */
  const requested = safeRedirectTo(formData.get("redirectTo"), "");
  redirect(requested.startsWith("/admin") && !requested.startsWith("/admin/login")
    ? requested
    : "/admin");
}

export async function adminLogoutAction(): Promise<void> {
  const identity = await getAdminIdentity();
  if (identity) {
    await recordAdminAction({
      identity,
      action: "admin.logout",
    });
  }
  await revokeCurrentAdminSession();
  redirect("/admin/login");
}
