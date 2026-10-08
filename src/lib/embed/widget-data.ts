import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { parseWidgetPayload, type WidgetData } from "./widget-html";

/**
 * The widget's one database read: `public.org_job_widget(p_org_id)` (migration 0237), SECURITY DEFINER and executable by service_role only.
 *
 * The function states every gate itself (organisation verified, widget switched on, organisation not created by a QA account, postings internal, open, not removed / draft /
 * unlisted / superseded, within the closing date) and returns NULL for any failed gate, so this returns null for "nothing to show" without ever learning why. It is called
 * through the service-role client, the only role allowed to execute it: no session, no cookie, no request state is read anywhere on this path.
 *
 * A database ERROR is not "nothing to show": it throws, so the route's cached output is never replaced by a neutral page because of an outage.
 */
type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function fetchWidgetPayload(orgId: string): Promise<WidgetData | null> {
  // The function is not in the generated Database types until they are regenerated after 0237 is applied; the single argument is always sent by name.
  const client = createServiceRoleClient() as unknown as RpcClient;
  const { data, error } = await client.rpc("org_job_widget", { p_org_id: orgId });
  if (error) throw new Error(`org_job_widget failed: ${error.message}`);
  return parseWidgetPayload(data);
}
