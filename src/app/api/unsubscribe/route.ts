import { handleOneClickUnsubscribe } from "@/app/unsubscribe/one-click";

/** POST /api/unsubscribe: the one-click unsubscribe (RFC 8058). Exports POST only, on purpose: a GET here must change nothing. All the rules live in handleOneClickUnsubscribe. */
export async function POST(request: Request): Promise<Response> {
  return handleOneClickUnsubscribe(request);
}
