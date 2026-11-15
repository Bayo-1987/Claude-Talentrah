import { handleSubscribe } from "@/lib/notifications/push/routes";
import { realRouteDeps } from "@/lib/notifications/push/session-deps";

export const dynamic = "force-dynamic";

/** POST /api/push/subscribe: opt in or reconcile this device. All the rules live in handleSubscribe. */
export async function POST(request: Request): Promise<Response> {
  return handleSubscribe(request, realRouteDeps());
}
