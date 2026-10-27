import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * True when the user belongs to at least one organisation. Read through the user's OWN client, so the organisation_members row policy (0026) decides, the same as src/app/dashboard/page.tsx
 * and src/lib/employer/membership.ts. A failed lookup answers false: for the switch that is the safe direction (no menu item, and the action refuses).
 */
export async function isOrganisationMember(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organization_members").select("organization_id").eq("user_id", userId).limit(1).maybeSingle();
  if (error) {
    console.error("[switch-side] membership lookup failed:", error.message);
    return false;
  }
  return !!data;
}
