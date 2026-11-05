/**
 * PR-U1: who may upload. The permission `jobs_import` is checked at EVERY entry: the page, the preview route, the confirm route, the nav entry (and the role editor lists it from the
 * enum catalog with a label). The two route handlers each carry their own guard (the protected layout does not cover route handlers): own-origin, then the admin SESSION (never the
 * seeker session): none -> 401; no permission -> 403 plus a `jobs.import_denied` audit row. Nothing is read from the file, nothing is written, before those pass.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleConfirm, handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { JOBS_IMPORT_AUDIT, JOBS_IMPORT_PERMISSION } from "@/lib/jobs/sheet-import/constants";
import { PERMISSION_AREA_LABELS } from "@/lib/admin/permission-labels";
import { ADMIN, formRequest, makeDeps, sheetOf, sha12 } from "./support";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const SHEET = sheetOf({ link: 2, email: 1 });
const CONFIRM_FIELDS = { sha12: sha12(SHEET), importable: "3", batches: "1", tick: "on" };

describe("the permission itself", () => {
  it("is named jobs_import, is in the permission union and the labels, and is in the generated enum", () => {
    expect(JOBS_IMPORT_PERMISSION).toBe("jobs_import");
    expect(PERMISSION_AREA_LABELS.jobs_import).toBe("Jobs import");
    expect(read("src/lib/admin/session.ts")).toMatch(/\|\s*"jobs_import"/);
    expect(read("src/lib/supabase/types.ts").match(/"jobs_import"/g)?.length).toBe(2);
  });
});

describe.each([
  ["preview", handlePreview, {}],
  ["confirm", handleConfirm, CONFIRM_FIELDS],
] as const)("the %s route", (name, handler, fields) => {
  it("answers 401 with no admin session, and writes nothing", async () => {
    const { deps, db, audit } = makeDeps({ getAdmin: async () => null });
    const res = await handler(formRequest(name, SHEET, fields), deps);
    expect(res.status).toBe(401);
    expect(db.upserts).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });

  it("answers 403 without jobs_import, writes a jobs.import_denied audit row, and touches nothing else", async () => {
    const { deps, db, audit } = makeDeps({ getAdmin: async () => ({ ...ADMIN, permissions: ["blog", "people_list", "data_export", "user_messaging"] }) });
    const res = await handler(formRequest(name, SHEET, fields), deps);
    expect(res.status).toBe(403);
    expect(audit.calls.map((c) => c.kind)).toEqual(["denied"]);
    expect(audit.calls[0].detail).toEqual({ route: name, reason: "missing_permission" });
    expect(db.upserts).toHaveLength(0);
    expect(db.selects).toHaveLength(0);
  });

  it("answers 403 for a request from another origin, before it even asks who is signed in", async () => {
    let asked = 0;
    const { deps } = makeDeps({ getAdmin: async () => (asked++, ADMIN) });
    const res = await handler(formRequest(name, SHEET, fields, { origin: "https://evil.example.test" }), deps);
    expect(res.status).toBe(403);
    const none = await handler(formRequest(name, SHEET, fields, { origin: null }), deps);
    expect(none.status).toBe(403);
    expect(asked).toBe(0);
  });

  it("lets a holder of jobs_import through (the control case)", async () => {
    const { deps } = makeDeps();
    const res = await handler(formRequest(name, SHEET, fields), deps);
    expect(res.status).toBe(200);
  });

  it("uses the audit action name from one list", () => {
    expect(JOBS_IMPORT_AUDIT.denied).toBe("jobs.import_denied");
  });
});

describe("the other entries", () => {
  it("the page asks for jobs_import in the page itself", () => {
    expect(read("src/app/admin/(protected)/jobs-import/page.tsx")).toMatch(/requirePermission\(\s*"jobs_import"\s*\)/);
  });

  it("each route file exports POST through its handler, is dynamic, and has a duration limit", () => {
    for (const [file, handler] of [["preview", "handlePreview"], ["confirm", "handleConfirm"]] as const) {
      const src = read(`src/app/admin/jobs-import/${file}/route.ts`);
      expect(src).toMatch(new RegExp(`export async function POST[\\s\\S]*${handler}\\(`));
      expect(src).toMatch(/export const dynamic = "force-dynamic"/);
      expect(src).toMatch(/export const maxDuration = \d+/);
      expect(src).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE)/);
    }
  });

  it("the nav entry is shown only for holders (it carries the permission)", () => {
    expect(read("src/components/admin/admin-nav.tsx")).toMatch(/href:\s*"\/admin\/jobs-import"[^}]*permission:\s*"jobs_import"/);
  });

  it("the real wiring takes the identity from the admin session and writes only through the service-role client", () => {
    const wiring = read("src/lib/jobs/sheet-import/deps.ts");
    expect(wiring).toMatch(/getAdmin/);
    expect(wiring).toMatch(/createServiceRoleClient/);
    for (const f of ["handlers.ts", "upload.ts", "write.ts", "constants.ts", "limits.ts"]) {
      const src = read(`src/lib/jobs/sheet-import/${f}`);
      expect(src, f).not.toMatch(/supabase\/(client|server)"/);
      expect(src, f).not.toMatch(/createServiceRoleClient/);
    }
  });
});
