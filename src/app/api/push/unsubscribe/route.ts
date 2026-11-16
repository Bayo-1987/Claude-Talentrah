import { handleUnsubscribe } from "@/lib/notifications/push/unsubscribe-route";
import { realUnsubscribeDeps } from "@/lib/notifications/push/unsubscribe-deps";

export const dynamic = "force-dynamic";

/** POST /api/push/unsubscribe: remove this device's push subscription row on sign-out. All the rules live in handleUnsubscribe. */
export async function POST(request: Request): Promise<Response> {
  return handleUnsubscribe(request, realUnsubscribeDeps());
}
