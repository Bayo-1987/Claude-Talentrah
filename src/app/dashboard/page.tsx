import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { dashboardDestination } from "@/lib/auth/dashboard-destination";

/**
 * "Go to your dashboard" (HWR-2): the masthead on the info pages links here, and the destination is chosen on click, not on render, so those pages do no server work per
 * request for it. An organisation member goes to /employer, everyone else to /jobs (it used to be the M1 placeholder that always redirected to /jobs). Signed-out visitors
 * never reach this page: the proxy's seeker gate sends them to /login.
 */
export default async function DashboardPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("organization_members").select("organization_id").eq("user_id", user.id).limit(1).maybeSingle();
  redirect(dashboardDestination(error || !data ? null : { organizationId: data.organization_id }));
}
