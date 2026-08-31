import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AdminRole } from "@/lib/admin/session";

export interface OperatorRow {
  id: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

/**
 * Every operator, active and disabled.
 *
 * DISABLED ROWS ARE SHOWN, not filtered out — the same call the course catalog
 * makes about inactive rows. A disabled operator is the thing somebody came
 * here to re-enable, and a management screen that hides them would send them
 * back to the CLI.
 *
 * Ordered active-first, then by email, so the list does not reshuffle when
 * somebody is disabled — a row jumping position on click is how the wrong
 * button gets pressed next.
 */
export async function listOperators(): Promise<OperatorRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, email, display_name, role, disabled_at, last_login_at, created_at")
    .order("disabled_at", { ascending: true, nullsFirst: true })
    .order("email", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name ?? null,
    // Narrowed rather than cast: the column is `text` with a CHECK, so the
    // type system cannot know it is one of two values.
    role: r.role === "super_admin" ? "super_admin" : "standard",
    disabledAt: r.disabled_at ?? null,
    lastLoginAt: r.last_login_at ?? null,
    createdAt: r.created_at,
  }));
}

/** Active super admins. Used to explain WHY a refusal happened, never to gate. */
export async function activeSuperAdminCount(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .is("disabled_at", null);
  if (error) throw error;
  return count ?? 0;
}
