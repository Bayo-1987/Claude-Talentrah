import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface FeatureFlagRow {
  key: string;
  label: string;
  enabled: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

/**
 * Every flag, on and off alike.
 *
 * A switched-off flag is the thing an operator came here to find, so this does
 * not filter — the same call the course catalog makes about inactive rows.
 * Ordered by label so the list does not reshuffle when one is toggled; a row
 * jumping position on click is how the wrong switch gets flipped next.
 */
export async function listFeatureFlags(): Promise<FeatureFlagRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("key, label, enabled, updated_at, updated_by")
    .order("label", { ascending: true });
  if (error) throw error;

  const ids = [...new Set((data ?? []).map((f) => f.updated_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase
      .from("profiles").select("id, first_name, last_name").in("id", ids);
    for (const p of people ?? []) {
      const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
      if (n) names.set(p.id, n);
    }
  }

  return (data ?? []).map((f) => ({
    key: f.key,
    label: f.label,
    enabled: f.enabled,
    updatedAt: f.updated_at,
    // Null is shown as "not recorded" rather than blank: updated_by is
    // ON DELETE SET NULL, so an absent name means the operator is gone, not
    // that nobody touched it.
    updatedByName: f.updated_by ? (names.get(f.updated_by) ?? null) : null,
  }));
}
