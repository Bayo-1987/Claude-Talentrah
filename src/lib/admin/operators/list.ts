import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
export interface OperatorRow {
  id: string;
  email: string;
  displayName: string | null;
  roleId: string | null;
  roleName: string | null;
  /** True when this operator's role grants `operators` — i.e. can manage others. */
  managesOperators: boolean;
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
  const [{ data, error }, { data: roles }, { data: perms }] = await Promise.all([
    supabase
      .from("admin_users")
      .select("id, email, display_name, role_id, disabled_at, last_login_at, created_at")
      .order("disabled_at", { ascending: true, nullsFirst: true })
      .order("email", { ascending: true }),
    supabase.from("admin_roles").select("id, name"),
    supabase.from("admin_role_permissions").select("role_id").eq("permission", "operators"),
  ]);
  if (error) throw error;

  const nameFor = new Map((roles ?? []).map((r) => [r.id, r.name]));
  const managing = new Set((perms ?? []).map((p) => p.role_id));

  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name ?? null,
    roleId: r.role_id ?? null,
    // Null role name is shown as such rather than as a default. 0075 leaves
    // role_id nullable precisely so "no permissions" is visible.
    roleName: r.role_id ? (nameFor.get(r.role_id) ?? null) : null,
    managesOperators: r.role_id ? managing.has(r.role_id) : false,
    disabledAt: r.disabled_at ?? null,
    lastLoginAt: r.last_login_at ?? null,
    createdAt: r.created_at,
  }));
}

export interface RoleRow {
  id: string;
  name: string;
  isBuiltin: boolean;
  permissions: string[];
}

/** Every role and what it grants. */
export async function listRoles(): Promise<RoleRow[]> {
  const supabase = createServiceRoleClient();
  const [{ data: roles, error }, { data: perms }] = await Promise.all([
    supabase.from("admin_roles").select("id, name, is_builtin").order("name"),
    supabase.from("admin_role_permissions").select("role_id, permission"),
  ]);
  if (error) throw error;
  const byRole = new Map<string, string[]>();
  for (const p of perms ?? []) byRole.set(p.role_id, [...(byRole.get(p.role_id) ?? []), p.permission]);
  return (roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    isBuiltin: r.is_builtin,
    permissions: byRole.get(r.id) ?? [],
  }));
}

/**
 * Active operators who can manage operators. Used to EXPLAIN a refusal before
 * it happens, never to gate — the gate is admin_operators_covered(), inside
 * the same statement as the write.
 */
export async function operatorsCoverageCount(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data: perms } = await supabase
    .from("admin_role_permissions").select("role_id").eq("permission", "operators");
  const ids = (perms ?? []).map((p) => p.role_id);
  if (!ids.length) return 0;
  const { count, error } = await supabase
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .in("role_id", ids)
    .is("disabled_at", null);
  if (error) throw error;
  return count ?? 0;
}
