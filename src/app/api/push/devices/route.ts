import { handleDevices } from "@/lib/notifications/push/routes";
import { realRouteDeps } from "@/lib/notifications/push/session-deps";

export const dynamic = "force-dynamic";

/** GET /api/push/devices: this person's registered devices. All the rules live in handleDevices. */
export async function GET(request: Request): Promise<Response> {
  return handleDevices(request, realRouteDeps());
}
