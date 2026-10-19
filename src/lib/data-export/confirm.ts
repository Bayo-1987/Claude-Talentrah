import "server-only";
import { authLinkWithReturn } from "@/lib/auth/redirect-to";
import { auditDownloadDenied } from "./audit";
import { UUID_PATTERN } from "./constants";
import { ALLOW, NO_STORE, emptyAnswer, genericRefusal, htmlResponse, isPrefetch, type DownloadDeps } from "./download";
import { expiryText, renderConfirmPage } from "./pages";
import { getRow } from "./store";

/**
 * GET /data-export/<id>: the page the email link opens. READ-ONLY, safe to fetch any number of times: it claims nothing, deletes nothing and writes no audit row, except the existing
 * `export_denied` row for a signed-in account that is NOT the owner (one row per such GET, pinned by tests/data-export/download-confirm.test.ts).
 *
 * It shows the confirm page ONLY in a state in which the claim would succeed (the owner, generated, unclaimed, undeleted, unexpired). That test is advisory: the claim in the POST is the
 * only authority. Every other state (another account, used, expired, deleted, unknown, malformed) gets the SAME refusal page, so the answer for another account's id is byte-identical to the
 * answer for an id that does not exist. An expired object is NOT deleted here (the POST's claim-failure path and the hourly sweep do that).
 */
export async function handleConfirm(request: Request, exportId: string, deps: DownloadDeps): Promise<Response> {
  if (request.method !== "GET") return emptyAnswer(ALLOW);
  if (isPrefetch(request)) return emptyAnswer(ALLOW);

  if (!UUID_PATTERN.test(exportId)) return genericRefusal();
  const id = exportId.toLowerCase();

  const user = await deps.getUser();
  if (!user) {
    const to = new URL(authLinkWithReturn("/login", `/data-export/${id}`), request.url);
    return new Response(null, { status: 302, headers: { Location: to.toString(), ...NO_STORE, "Referrer-Policy": "no-referrer" } });
  }

  let row: Awaited<ReturnType<typeof getRow>>;
  try {
    row = await getRow(deps.service, id);
  } catch {
    return genericRefusal();
  }
  if (!row) return genericRefusal();
  if (row.user_id !== user.id) {
    try {
      await auditDownloadDenied({ exportId: id });
    } catch {
      /* the answer is the same either way */
    }
    return genericRefusal();
  }
  const now = (deps.now ?? (() => new Date()))().getTime();
  const usable = row.status === "generated" && row.claimed_at === null && row.deleted_at === null && !!row.object_path && !!row.expires_at && new Date(row.expires_at).getTime() > now;
  if (!usable || !row.expires_at) return genericRefusal();

  return htmlResponse(200, renderConfirmPage({ id, expiresText: expiryText(row.expires_at) }));
}
