import { setPreference } from "./apply";
import { parsePreference } from "./preference";

/**
 * POST /api/unsubscribe?token=..&pref=.. : the one-click unsubscribe of RFC 8058. A mail client that sees `List-Unsubscribe: <this url>` plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` shows its
 * own "Unsubscribe" button and POSTs here with the body `List-Unsubscribe=One-Click`, with no page and no click on a link. A GET here changes nothing (the route exports no GET; the handler also answers
 * 405 itself), so a link scanner that fetches the URL does nothing.
 *
 * Same token, same `pref`, same RPCs as the confirm button (apply.ts). Answers: 200 done, 400 no token or a body that is not the one-click form, 404 no row has that token, 500 database error. The
 * answers carry no token and no information about whose it was, and the log line never carries the token.
 */
const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

const reply = (status: number, text: string) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function handleOneClickUnsubscribe(request: Request): Promise<Response> {
  if (request.method !== "POST") return reply(405, "Method not allowed");
  const url = new URL(request.url);
  const token = (url.searchParams.get("token") ?? "").trim();
  if (!token) return reply(400, "Missing token");
  const form = new URLSearchParams(await request.text().catch(() => ""));
  if (`List-Unsubscribe=${form.get("List-Unsubscribe") ?? ""}` !== ONE_CLICK_BODY) return reply(400, "Not a one-click unsubscribe");

  const result = await setPreference(token, parsePreference(url.searchParams.get("pref") ?? undefined), false, "one-click unsubscribe");
  if (result === "done") return reply(200, "Unsubscribed");
  return result === "unmatched" ? reply(404, "Link not recognised") : reply(500, "Could not unsubscribe");
}
