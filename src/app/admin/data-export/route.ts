import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendDataExportEmail } from "@/lib/account-deletion/export-email";
import { listNigerianBanks } from "@/lib/paystack/client";
import { SITE_ORIGIN } from "@/lib/seo/site";
import { auditDenied } from "@/lib/data-export/audit";
import { DATA_EXPORT_PERMISSION } from "@/lib/data-export/constants";
import { GENERIC_FAILED, GENERIC_UNAVAILABLE, REFUSAL_MESSAGES, SUPERSEDED_MESSAGE } from "@/lib/data-export/messages";
import { cancelExport, startExport } from "@/lib/data-export/start";
import { parseCancelFields, parseStartFields } from "@/lib/data-export/validate";

export const dynamic = "force-dynamic";
// Generation reads one person's whole history table by table, builds the file, uploads it and sends two emails. Valid on every plan (300 s is the Hobby maximum; the project is on Pro now,
// but a literal 300 is what the repo pins, see the ingest route). What happens when the limit is hit is in docs/admin-data-export.md: the attempt becomes `failed`, the partial object is
// removed by the sweep, and a new export can start at once.
export const maxDuration = 300;

/**
 * POST /admin/data-export: an admin starts an export for one person, or cancels an unused one. The ONLY way an export begins; there is no user-facing page or button.
 *
 * ITS OWN GUARD, because the protected layout does not cover route handlers and `requirePermission` redirects (a handler cannot answer a redirect with a refusal). `getAdmin()` reads the admin
 * session (never the seeker session): no identity -> 401; an identity without `data_export` -> 403 AND a `people.export_denied` audit row. POST only; the request must come from this site's
 * own origin; the target comes only from the validated form field.
 *
 * Malformed fields (a ticket that does not match the pattern, a reason or check that is not on the pick-list) answer 400 and write NOTHING: no start was attempted, and the ticket field in
 * particular must not be copied into a log kept for three years. A target that is not a uuid is different: it is a refusal, audited, and the input is not copied.
 */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return NextResponse.json({ ok: false, message: "That request did not come from this site." }, { status: 403 });

  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ ok: false, message: "Sign in to the admin area." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const operation = body.action === "cancel" ? "cancel" : "start";
  const who = { adminId: admin.adminId, email: admin.email, sessionId: admin.sessionId };

  if (!admin.permissions.includes(DATA_EXPORT_PERMISSION)) {
    await auditDenied(who, { operation, reason: "missing_permission" });
    return NextResponse.json({ ok: false, message: "You do not have the data export permission." }, { status: 403 });
  }

  const targetRaw = typeof body.target === "string" ? body.target.trim() : "";
  const service = createServiceRoleClient();

  if (operation === "cancel") {
    const fields = parseCancelFields(body);
    if (!fields.ok) return NextResponse.json({ ok: false, field: fields.field, message: "Enter the support ticket reference." }, { status: 400 });
    const result = await cancelExport({ service, admin: who }, { targetRaw, ticket: fields.fields.ticket });
    if (result.status === "cancelled") return NextResponse.json({ ok: true, message: "The unused export was cancelled. A new one can be started now." });
    if (result.status === "refused") return NextResponse.json({ ok: false, code: result.code, message: REFUSAL_MESSAGES[result.code].message }, { status: REFUSAL_MESSAGES[result.code].status });
    if (result.status === "unavailable") return NextResponse.json({ ok: false, message: GENERIC_UNAVAILABLE }, { status: 503 });
    return NextResponse.json({ ok: false, message: GENERIC_FAILED }, { status: 500 });
  }

  const fields = parseStartFields(body);
  if (!fields.ok) {
    const what = { ticket: "Enter the support ticket reference.", reason: "Choose a reason.", requesterCheck: "Choose how the requester was checked." }[fields.field];
    return NextResponse.json({ ok: false, field: fields.field, message: what }, { status: 400 });
  }

  const result = await startExport(
    {
      service,
      admin: who,
      send: sendDataExportEmail,
      siteOrigin: SITE_ORIGIN,
      supportUrl: `${SITE_ORIGIN}/contact`,
      from: "Talentrah <notifications@talentrah.com>",
      loadBankNames: async () => new Map((await listNigerianBanks()).map((b) => [b.code, b.name])),
    },
    { targetRaw, ...fields.fields },
  );

  switch (result.status) {
    case "started":
      return NextResponse.json({ ok: true, message: "The export was generated and the link was emailed to the person. The file is deleted when it is opened or after 72 hours." });
    case "refused":
      return NextResponse.json({ ok: false, code: result.code, message: REFUSAL_MESSAGES[result.code].message }, { status: REFUSAL_MESSAGES[result.code].status });
    case "superseded":
      return NextResponse.json({ ok: false, message: SUPERSEDED_MESSAGE }, { status: 409 });
    case "unavailable":
      return NextResponse.json({ ok: false, message: GENERIC_UNAVAILABLE }, { status: 503 });
    default:
      return NextResponse.json({ ok: false, message: GENERIC_FAILED }, { status: 500 });
  }
}
