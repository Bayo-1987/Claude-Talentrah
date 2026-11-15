import { isOwnOrigin } from "@/lib/data-export/origin";
import type { NotificationErrorCode, PushDevicesResponse, PushRegisterResponse, PushSubscriptionClientRow, RegisterPushSubscriptionArgs } from "../contract";
import { NOTIFICATION_FLAGS } from "../contract";
import { NotificationDbError } from "../contract-db";

/** A request body larger than this is refused before it is parsed. A subscription is a few hundred bytes. */
export const MAX_BODY_BYTES = 4096;

/** What the routes do for a signed-in person, through that person's own session. Built in session-deps.ts; faked in the tests. */
export type PushSession = {
  register(args: RegisterPushSubscriptionArgs): Promise<string>;
  listDevices(): Promise<PushSubscriptionClientRow[]>;
  removeDevice(id: string): Promise<void>;
};

export type PushRouteDeps = {
  env: { PWA_KILL?: string };
  flagOn(key: string): Promise<boolean>;
  /** The signed-in person's session, or null when nobody is signed in. */
  session(): Promise<PushSession | null>;
};

const STATUS: Record<NotificationErrorCode, number> = { permission_denied: 401, invalid_parameter: 400, refused: 422, unknown: 500 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every answer: JSON, never cached. */
function answer(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** A failure is ONLY the contract's code. The database's message, its SQLSTATE and its refusal reason stay on the server. */
function fail(code: NotificationErrorCode, status = STATUS[code]): Response {
  return answer({ error: code }, status);
}

function failFrom(error: unknown): Response {
  return fail(error instanceof NotificationDbError ? error.info.code : "unknown");
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** A short device label from the User-Agent, so the raw header (which can identify a person) is never stored. */
function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone|iPad/i.test(ua)) return "iPhone web app";
  if (/Android/i.test(ua)) return /Chrome/i.test(ua) ? "Android Chrome" : "Android browser";
  return "Browser";
}

async function pushAllowed(deps: PushRouteDeps): Promise<boolean> {
  if (deps.env.PWA_KILL === "1") return false;
  try {
    return (await deps.flagOn(NOTIFICATION_FLAGS.master)) === true && (await deps.flagOn(NOTIFICATION_FLAGS.pushSender)) === true;
  } catch {
    return false;
  }
}

/** POST /api/push/subscribe: opt in, and reconcile (posting the same device again is harmless). Closed while the flags are off or the kill switch is on. */
export async function handleSubscribe(request: Request, deps: PushRouteDeps): Promise<Response> {
  if (!isOwnOrigin(request)) return fail("refused", 403);
  const session = await deps.session();
  if (!session) return fail("permission_denied");
  if (!(await pushAllowed(deps))) return fail("refused", 403);

  const body = await readObject(request);
  if (!body || !text(body.endpoint) || !text(body.p256dh) || !text(body.auth)) return fail("invalid_parameter");
  if (body.timezone !== undefined && body.timezone !== null && typeof body.timezone !== "string") return fail("invalid_parameter");

  const args: RegisterPushSubscriptionArgs = { p_endpoint: body.endpoint, p_p256dh: body.p256dh, p_auth: body.auth, p_ua: deviceLabel(request.headers.get("user-agent")) };
  if (typeof body.timezone === "string") args.p_timezone = body.timezone;
  try {
    const id = await session.register(args);
    return answer({ id } satisfies PushRegisterResponse);
  } catch (error) {
    return failFrom(error);
  }
}

/** GET /api/push/devices: this person's devices, five columns. Stays open when the flags are off, so a person can always see and remove what is registered. */
export async function handleDevices(_request: Request, deps: PushRouteDeps): Promise<Response> {
  const session = await deps.session();
  if (!session) return fail("permission_denied");
  try {
    const rows = await session.listDevices();
    const devices = rows.map(({ id, ua_short, created_at, last_seen_at, revoked_at }) => ({ id, ua_short, created_at, last_seen_at, revoked_at }));
    return answer({ devices } satisfies PushDevicesResponse);
  } catch (error) {
    return failFrom(error);
  }
}

/** POST /api/push/devices/remove: delete one of this person's devices by id. Stays open when the flags are off. */
export async function handleDeviceRemove(request: Request, deps: PushRouteDeps): Promise<Response> {
  if (!isOwnOrigin(request)) return fail("refused", 403);
  const session = await deps.session();
  if (!session) return fail("permission_denied");
  const body = await readObject(request);
  if (!body || !text(body.id) || !UUID.test(body.id)) return fail("invalid_parameter");
  try {
    await session.removeDevice(body.id);
    return answer({});
  } catch (error) {
    return failFrom(error);
  }
}
