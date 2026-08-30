"use server";

import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireAdmin } from "./require-admin";
import { recordAdminAction } from "./audit";
import { beginEnrolment, completeEnrolment } from "./mfa";
import type { MfaEnrolState } from "./mfa-state";

/**
 * Enrolment, in two submissions.
 *
 * Both take the password, and that is the cost of storing nothing between
 * them: the MFA API acts on a Supabase session, /admin/login throws its
 * session away by design, and Server Actions are stateless — so the
 * alternative is an access token in a cookie on the one surface built to have
 * no credential at rest. One extra password entry during a one-time setup is
 * the cheaper trade.
 *
 * Both actions call requireAdmin() themselves. The page is already behind the
 * guard, but a Server Action is a POST endpoint reachable without ever
 * rendering the page that hosts it, so it establishes identity rather than
 * inheriting it.
 */
export async function startMfaEnrolmentAction(
  _prev: MfaEnrolState,
  formData: FormData,
): Promise<MfaEnrolState> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  if (!password) return { status: "error", message: "Enter your password." };

  const result = await beginEnrolment(admin.email, password);
  if ("error" in result) return { status: "error", message: result.error };

  return {
    status: "started",
    factorId: result.factorId,
    secret: result.secret,
    uri: result.uri,
  };
}

export async function confirmMfaEnrolmentAction(
  _prev: MfaEnrolState,
  formData: FormData,
): Promise<MfaEnrolState> {
  const admin = await requireAdmin();
  const password = String(formData.get("password") ?? "");
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  if (!password || !factorId || !code) {
    return { status: "error", message: "Password and code are both required.", factorId };
  }

  const result = await completeEnrolment(admin.email, password, factorId, code);
  if ("error" in result) {
    // Keep the factor id so the page can stay on step two rather than making
    // the operator scan a fresh QR for a mistyped digit.
    return { status: "error", message: result.error, factorId };
  }

  /*
   * The column is written only AFTER the factor is verified. Writing it at
   * `enroll` time would mark an operator as protected while holding a factor
   * they had never proved they could use — and the next login would then
   * demand a code they cannot produce, which is the one drift direction that
   * locks somebody out.
   */
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("admin_users")
    .update({ mfa_enrolled_at: new Date().toISOString() })
    .eq("id", admin.adminId);
  if (error) {
    console.error("[admin-mfa] could not record enrolment", error);
    return { status: "error", message: "Verified, but we could not record it. Try again.", factorId };
  }

  await recordAdminAction({
    identity: admin,
    action: "admin.mfa_enrolled",
    targetTable: "admin_users",
    targetId: admin.adminId,
  });

  redirect("/admin");
}
