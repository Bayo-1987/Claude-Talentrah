import type { NotificationKind, PushPayload } from "../contract";

/** The wire payload is exactly these five keys, at most 1 KB. The contract's `url` travels as `path`; `v` and `kind` stay on the server. */
export const WIRE_PAYLOAD_KEYS = ["title", "body", "path", "tag", "badge"] as const;
export const MAX_WIRE_BYTES = 1024;

/**
 * Lock-screen copy is generic on purpose: it names no person, job title, company, score or status, because a lock screen is read by whoever is holding the phone.
 * One tag per kind, so a second alert of the same kind replaces the first instead of stacking.
 */
const COPY: Record<NotificationKind, { title: string; body: string; tag: string }> = {
  new_applicant: { title: "Talentrah", body: "You have a new notification. Open Talentrah to see it.", tag: "talentrah-new-applicant" },
  application_viewed: { title: "Talentrah", body: "You have a new notification. Open Talentrah to see it.", tag: "talentrah-application-viewed" },
  match_alert: { title: "Talentrah", body: "You have a new notification. Open Talentrah to see it.", tag: "talentrah-match-alert" },
  admin_message: { title: "Talentrah", body: "You have a new message from Talentrah.", tag: "talentrah-admin-message" },
};

const FALLBACK_PATH = "/dashboard";

/** The worker's rule for a click target, applied here too: starts with one slash, no scheme, no backslash, no control characters. */
function safePath(url: string): string {
  if (typeof url !== "string" || url.length === 0 || url.length > 200) return FALLBACK_PATH;
  if (url[0] !== "/" || url[1] === "/" || url[1] === "\\") return FALLBACK_PATH;
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return FALLBACK_PATH;
  return url;
}

export function buildPushPayload(kind: NotificationKind, input: { url: string; badge: number | null }): PushPayload {
  const copy = COPY[kind];
  return { v: 1, kind, title: copy.title, body: copy.body, url: safePath(input.url), tag: copy.tag, badge: input.badge };
}

/** The bytes that go on the wire. Throws when the result would exceed 1 KB; the sender turns that into a release, never a send. */
export function toWireJson(payload: PushPayload): string {
  const wire = { title: payload.title, body: payload.body, path: payload.url, tag: payload.tag, badge: payload.badge };
  const json = JSON.stringify(wire);
  if (Buffer.byteLength(json) > MAX_WIRE_BYTES) throw new Error("push: the payload is over 1 KB");
  return json;
}
