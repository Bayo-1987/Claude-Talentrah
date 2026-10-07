"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { revalidateEmbed } from "@/lib/embed/revalidate";

/**
 * The Company Profile card's switch and "max jobs" choice for the employer job-list widget (plan v2.1, owner-approved 7 Oct 2026).
 *
 * The organisation comes from the signed-in employer's own membership, never from the form. The write goes through the user's SESSION client, so row security
 * (members of the organisation only) and the column grants of migration 0237 (insert organization_id, enabled, max_items; update enabled, max_items) are what authorise it,
 * not this code. `max_items` is checked here for a clear message and again by the table's own CHECK (1 to 20). The embed page is purged only after the write succeeded.
 */
export type WidgetSettingsState = { error: string } | { ok: true } | null;

// The table is not in the generated Database types until they are regenerated after 0237 is applied.
type WidgetsTable = {
  upsert(row: { organization_id: string; enabled: boolean; max_items: number }, options: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
};

export async function saveJobWidgetSettingsAction(_prev: WidgetSettingsState, form: FormData): Promise<WidgetSettingsState> {
  const { organization } = await requireEmployer();

  const rawMax = String(form.get("maxItems") ?? "").trim();
  const maxItems = /^\d{1,2}$/.test(rawMax) ? Number(rawMax) : NaN;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    return { error: "Choose a whole number of jobs between 1 and 20." };
  }
  const enabled = form.get("enabled") === "on";

  const supabase = await createClient();
  const table = (supabase as unknown as { from(name: string): WidgetsTable }).from("employer_widgets");
  const { error } = await table.upsert({ organization_id: organization.id, enabled, max_items: maxItems }, { onConflict: "organization_id" });
  if (error) {
    console.error("[employer-widget] save failed", organization.id, error.message);
    return { error: "We couldn't save the widget settings. Try again in a moment." };
  }

  revalidatePath("/employer/profile");
  revalidateEmbed(organization.id);
  return { ok: true };
}
