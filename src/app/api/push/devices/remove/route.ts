import { handleDeviceRemove } from "@/lib/notifications/push/routes";
import { realRouteDeps } from "@/lib/notifications/push/session-deps";

export const dynamic = "force-dynamic";

/** POST /api/push/devices/remove: remove one of this person's devices. All the rules live in handleDeviceRemove. */
export async function POST(request: Request): Promise<Response> {
  return handleDeviceRemove(request, realRouteDeps());
}
