import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface JobWidgetSettings {
  enabled: boolean;
  maxItems: number;
}

type WidgetsRead = {
  select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { enabled: boolean; max_items: number } | null; error: { message: string; code?: string } | null }> } };
};

/**
 * The signed-in employer's own widget settings, read through their SESSION client (row security: members of the organisation only).
 *
 * No row yet is the default (switched off, 10 jobs). A read error returns null so the Company Profile page simply leaves the card out instead of failing as a whole
 * (the table does not exist before migration 0237 is applied, and an employer must never lose their profile page to that).
 */
export async function loadJobWidgetSettings(organizationId: string): Promise<JobWidgetSettings | null> {
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as { from(name: string): WidgetsRead })
    .from("employer_widgets")
    .select("enabled, max_items")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    console.error("[employer-widget] settings read failed", organizationId, error.message);
    return null;
  }
  return { enabled: data?.enabled ?? false, maxItems: data?.max_items ?? 10 };
}
