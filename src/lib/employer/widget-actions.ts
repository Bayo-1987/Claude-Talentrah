"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { revalidateEmbed } from "@/lib/embed/revalidate";
import { embedWidgetEnabled } from "@/lib/embed/feature";

/**
 * The Company Profile card's switch and "max jobs" choice for the employer job-list widget (plan v2.1, owner-approved 7 Oct 2026).
 *
 * The organisation comes from the signed-in employer's own membership, never from the form. The write goes through the user's SESSION client, so row security
 * (members of the organisation only) and the column grants of migration 0237 (insert organization_id, enabled, max_items; update enabled, max_items) are what authorise it,
 * not this code. `max_items` is checked here for a clear message and again by the table's own CHECK (1 to 20). The embed page is purged only after the write succeeded.
 */
export type WidgetSettingsState = { error: string } | { ok: true } | null;

// The table is not in the generated Database types until they are regenerated after 0237 is applied.
type DbError = { message: string; code?: string };
type WidgetsTable = {
  update(values: { enabled: boolean; max_items: number }): { eq(column: string, value: string): { select(columns: string): PromiseLike<{ data: Array<{ organization_id: string }> | null; error: DbError | null }> } };
  insert(row: { organization_id: string; enabled: boolean; max_items: number }): PromiseLike<{ error: DbError | null }>;
};

/**
 * UPDATE FIRST, THEN INSERT, NEVER AN UPSERT. 0237 grants `authenticated` UPDATE on (enabled, max_items) only and INSERT on (organization_id, enabled, max_items). An upsert is
 * INSERT ... ON CONFLICT DO UPDATE SET organization_id, enabled, max_items, which also updates organization_id, so Postgres refuses the whole statement (found by QA on a real stack).
 */
async function writeWidgetRow(table: WidgetsTable, organizationId: string, enabled: boolean, maxItems: number): Promise<DbError | null> {
  const update = async () => table.update({ enabled, max_items: maxItems }).eq("organization_id", organizationId).select("organization_id");

  const first = await update();
  if (first.error) return first.error;
  if (first.data && first.data.length > 0) return null;

  const inserted = await table.insert({ organization_id: organizationId, enabled, max_items: maxItems });
  if (!inserted.error) return null;
  // Two members saving the first row at the same moment: the other insert won (unique violation). The row exists now, so update it.
  if (inserted.error.code === "23505") {
    const second = await update();
    return second.error ?? (second.data && second.data.length > 0 ? null : inserted.error);
  }
  return inserted.error;
}

export async function saveJobWidgetSettingsAction(_prev: WidgetSettingsState, form: FormData): Promise<WidgetSettingsState> {
  const { organization } = await requireEmployer();

  const rawMax = String(form.get("maxItems") ?? "").trim();
  const maxItems = /^\d{1,2}$/.test(rawMax) ? Number(rawMax) : NaN;
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20) {
    return { error: "Choose a whole number of jobs between 1 and 20." };
  }
  const enabled = form.get("enabled") === "on";
  // The server-side switch (EMBED_WIDGET_ENABLED=1): until the owner has turned the feature on for the deployment, no organisation can switch its widget on.
  if (enabled && !embedWidgetEnabled()) return { error: "The job widget isn't available yet. We'll let you know when you can switch it on." };

  const supabase = await createClient();
  const table = (supabase as unknown as { from(name: string): WidgetsTable }).from("employer_widgets");
  const error = await writeWidgetRow(table, organization.id, enabled, maxItems);
  if (error) {
    console.error("[employer-widget] save failed", organization.id, error.message);
    return { error: "We couldn't save the widget settings. Try again in a moment." };
  }

  revalidatePath("/employer/profile");
  revalidateEmbed(organization.id);
  return { ok: true };
}
