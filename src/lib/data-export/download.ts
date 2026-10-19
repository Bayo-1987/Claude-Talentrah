import "server-only";
import { authLinkWithReturn } from "@/lib/auth/redirect-to";
import { auditDeleted, auditDownloadDenied, auditDownloaded } from "./audit";
import { UUID_PATTERN, parseObjectName } from "./constants";
import { isOwnOrigin } from "./origin";
import { REFERRER_POLICY } from "./referrer-policy";
import { renderRefusalPage } from "./pages";
import { claimDownload, downloadObject, getRow, markObjectDeleted, removeObject, type Client } from "./store";

/**
 * THE DOWNLOAD: POST /data-export/<id>, the only thing that claims a data export. (GET /data-export/<id> is the read-only confirm page, src/lib/data-export/confirm.ts; the person presses the
 * button on it and the browser POSTs here.) docs/admin-data-export.md has the picture.
 *
 * ORDER: method check -> prefetch check -> same-origin check -> session -> CLAIM (which takes both ids) -> stream -> delete in a `finally`.
 *
 *   - HEAD and OPTIONS are separate handlers that answer without calling this at all (src/app/data-export/[id]/route.ts): a link scanner or a browser probing the URL must never use up the
 *     single use. A GET never reaches this function, so a scanner's GET, a second GET or an extension's refetch only ever shows the page.
 *   - A request that says it is a prefetch (Sec-Purpose / Purpose: prefetch, or the Next router prefetch headers) answers without claiming either.
 *   - The Origin (or, failing that, the Referer) must name the host the request arrived on (src/lib/data-export/origin.ts), else the generic refusal and nothing is claimed.
 *   - Signed out -> 303 to the login page with the return trip (303, so the browser follows with a GET to the confirm page, never a replayed POST). Signed in as ANOTHER account -> the same
 *     generic refusal as an expired or used link, and a denied audit row.
 *   - Signed in as the owner -> claim_data_export_download (ONE conditional UPDATE: owner, unclaimed, undeleted, unexpired). The file is streamed from the private bucket with the service role,
 *     NOT through a signed URL (a signed URL is a bearer link that outlives the session check). Whether the stream finishes, fails or the client drops, the object is deleted and the row
 *     marked `deleted` once: a failed download consumes the single use, and support starts a new export.
 *   - One generic refusal for everything else (not yours, used, expired, never existed), so a probe learns nothing about which it was.
 *   - ONE counts-only log line per outcome (class only, never an id, an address or an error text): `[data-export] claimed` or `[data-export] refusal class=<origin_refused|claim_error|not_claimable|denied|object_unreadable>`.
 */

export interface DownloadDeps {
  service: Client;
  /** The signed-in user from the SEEKER session cookie, or null. */
  getUser: () => Promise<{ id: string } | null>;
  now?: () => Date;
}

const PREFETCH_HEADERS: Array<[string, RegExp]> = [
  ["sec-purpose", /prefetch|prerender/i],
  ["purpose", /prefetch|prerender/i],
  ["next-router-prefetch", /./],
  ["x-middleware-prefetch", /./],
];

export function isPrefetch(request: Request): boolean {
  return PREFETCH_HEADERS.some(([name, pattern]) => {
    const v = request.headers.get(name);
    return v !== null && pattern.test(v);
  });
}

export const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } as const;
export const ALLOW = "GET, HEAD, POST, OPTIONS";

/** An HTML page that is never cached or indexed and never sends the URL (it carries the export id) in any Referer (REFERRER_POLICY: strict-origin, the bare origin at most). */
export function htmlResponse(status: number, html: string): Response {
  return new Response(html, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": REFERRER_POLICY } });
}

/** The one answer for a link that cannot be used, whatever the reason: the same sentence as ever, now as a small page. */
export function genericRefusal(): Response {
  return htmlResponse(404, renderRefusalPage());
}

export function emptyAnswer(allow: string): Response {
  return new Response(null, { status: 204, headers: { ...NO_STORE, Allow: allow } });
}

const logRefusal = (refusalClass: "origin_refused" | "claim_error" | "not_claimable" | "denied" | "object_unreadable"): void => console.info(`[data-export] refusal class=${refusalClass}`);

export async function handleDownload(request: Request, exportId: string, deps: DownloadDeps): Promise<Response> {
  const { service } = deps;
  if (request.method !== "POST") return emptyAnswer(ALLOW);
  // A prefetch answers before the session is even read, and never reaches the database.
  if (isPrefetch(request)) return emptyAnswer(ALLOW);
  // A cross-site POST (or one with no Origin and no Referer) claims nothing. One class-only line, no id and no header value: this is the line that shows a real click being refused (an Origin the browser sent as
  // "null", say), which the same generic page would otherwise hide.
  if (!isOwnOrigin(request)) {
    logRefusal("origin_refused");
    return genericRefusal();
  }

  if (!UUID_PATTERN.test(exportId)) return genericRefusal();
  const id = exportId.toLowerCase();

  const user = await deps.getUser();
  if (!user) {
    const to = new URL(authLinkWithReturn("/login", `/data-export/${id}`), request.url);
    return new Response(null, { status: 303, headers: { Location: to.toString(), ...NO_STORE, "Referrer-Policy": REFERRER_POLICY } });
  }

  let path: string | null;
  try {
    path = await claimDownload(service, { exportId: id, userId: user.id });
  } catch {
    logRefusal("claim_error");
    return genericRefusal();
  }

  if (path === null) {
    // Not claimed. Two things worth doing, neither of which changes the answer: record a signed-in account that is NOT the owner opening somebody's link, and delete an expired
    // object the hourly sweep has not reached yet.
    let refusalClass: "not_claimable" | "denied" = "not_claimable";
    try {
      const row = await getRow(service, id);
      if (row && row.user_id !== user.id) {
        refusalClass = "denied";
        await auditDownloadDenied({ exportId: id });
      }
      if (row && row.status === "generated" && row.expires_at && new Date(row.expires_at).getTime() <= (deps.now ?? (() => new Date()))().getTime()) {
        if (row.object_path && (await removeObject(service, row.object_path))) {
          await markObjectDeleted(service, { exportId: row.id, attemptId: row.attempt_id, status: "expired" });
          await auditDeleted({ exportId: row.id, reason: "expired", userId: row.user_id });
        }
      }
    } catch {
      /* the answer is the same either way */
    }
    logRefusal(refusalClass);
    return genericRefusal();
  }

  // The claim won: from here the single use is spent, whatever happens.
  const named = parseObjectName(path);
  const attemptId = named?.attemptId ?? null;
  let cleaned = false;
  const cleanup = async (reason: "downloaded" | "stream_failed", bytes: number | null): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    // The object goes first, the row second: a row marked `deleted` with an object still in the bucket would hide it from the sweep's row pass (the bucket pass would still find it).
    const gone = await removeObject(service, path);
    if (gone && attemptId) await markObjectDeleted(service, { exportId: id, attemptId, status: "deleted" }).catch(() => false);
    if (reason === "downloaded") await auditDownloaded({ exportId: id, userId: user.id, bytes });
    await auditDeleted({ exportId: id, reason, userId: user.id });
  };

  const blob = await downloadObject(service, path);
  if (!blob) {
    await cleanup("stream_failed", null);
    logRefusal("object_unreadable");
    return genericRefusal();
  }
  console.info("[data-export] claimed");

  const source = blob.stream().getReader();
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.read();
        if (next.done) {
          // Cleanup BEFORE the close: work that starts after the response has ended can be frozen with the function instance, and the delete is the whole point.
          await cleanup("downloaded", sent);
          controller.close();
          return;
        }
        sent += next.value.byteLength;
        controller.enqueue(next.value);
      } catch {
        controller.error(new Error("download failed"));
        await cleanup("stream_failed", sent);
      }
    },
    async cancel() {
      // The client dropped. The single use is spent; the bytes still go.
      await source.cancel().catch(() => undefined);
      await cleanup("stream_failed", sent);
    },
  });

  const stamp = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="talentrah-data-${stamp}.json"`,
      "Content-Length": String(blob.size),
      "Referrer-Policy": REFERRER_POLICY,
    },
  });
}

