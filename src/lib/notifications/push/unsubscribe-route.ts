import { isOwnOrigin } from "@/lib/data-export/origin";

/**
 * POST /api/push/unsubscribe (U7): on sign-out the page asks the server to delete THIS device's subscription row. It has to be a server route because a signed-in person cannot read the
 * endpoint column, so a delete by endpoint through their own session cannot work. The person is the verified session's user, never anything in the request body, and the delete is filtered
 * by that user AND the endpoint: posting someone else's endpoint deletes nothing. Open whatever the push flags say, so a subscription made while they were on is still cleaned up.
 */

/** Same ceiling as the endpoint column's own check. */
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_BODY_BYTES = 4096;

export type UnsubscribeDeps = {
  /** The signed-in person, or null when nobody is signed in. */
  session(): Promise<{ userId: string } | null>;
  /** Delete the row with this endpoint that belongs to this user. Throws on a database failure. */
  removeByEndpoint(userId: string, endpoint: string): Promise<void>;
};

function answer(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readEndpoint(request: Request): Promise<string | null> {
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const endpoint = (parsed as Record<string, unknown>).endpoint;
    return typeof endpoint === "string" && endpoint.length > 0 && endpoint.length <= MAX_ENDPOINT_LENGTH ? endpoint : null;
  } catch {
    return null;
  }
}

export async function handleUnsubscribe(request: Request, deps: UnsubscribeDeps): Promise<Response> {
  if (!isOwnOrigin(request)) return answer({ error: "refused" }, 403);
  const session = await deps.session();
  if (!session) return answer({ error: "permission_denied" }, 401);
  const endpoint = await readEndpoint(request);
  if (endpoint === null) return answer({ error: "invalid_parameter" }, 400);
  try {
    await deps.removeByEndpoint(session.userId, endpoint);
    return answer({});
  } catch {
    // The database's words and codes stay on the server.
    return answer({ error: "unknown" }, 500);
  }
}
