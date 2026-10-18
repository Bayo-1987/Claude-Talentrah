/**
 * The audit vocabulary of the data export: the action strings are EXACTLY the list the design names, nothing in the code writes any other `people.export_*` string, the refusal codes are the
 * fixed list, the system actor is a sentinel of its own, and the strict writer throws where the ordinary one swallows.
 *
 * `admin_audit_log.action` is `text` (0060), so none of this needs a migration and a CHECK or enum for it must not be added: the last test holds that.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { admin as realService } from "../support/auth";
import { flags } from "../support/data-export-fixtures";
import { AdminAuditUnavailableError, SYSTEM_DATA_EXPORT_ACTOR, SYSTEM_TOOLING_ACTOR, recordAdminAction, recordAdminActionStrict } from "@/lib/admin/audit";
import { EXPORT_AUDIT_ACTIONS, FINISH_OUTCOMES, REFUSAL_CODES, TICKET_PATTERN } from "@/lib/data-export/constants";
import { auditCancelled, auditDeleted, auditFinished, auditGenerated, auditNoticeSent, auditRequested } from "@/lib/data-export/audit";
import { makeAdmin, releaseCreated } from "../support/data-export-fixtures";
import { afterEach } from "vitest";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

const ROOT = join(__dirname, "..", "..");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

describe("the action strings", () => {
  it("are exactly this list", () => {
    expect(Object.values(EXPORT_AUDIT_ACTIONS).sort()).toEqual(
      [
        "people.export_requested",
        "people.export_notice_sent",
        "people.export_generated",
        "people.export_downloaded",
        "people.export_deleted",
        "people.export_denied",
        "people.export_finished",
        "people.export_cancelled",
      ].sort(),
    );
  });

  it("no code under src writes a people.export_* string that is not on the list (the strings live in constants.ts only)", () => {
    const allowed = new Set<string>(Object.values(EXPORT_AUDIT_ACTIONS));
    const found = new Map<string, string[]>();
    for (const file of walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
      for (const m of readFileSync(file, "utf8").matchAll(/people\.export_[a-z_]+/g)) found.set(m[0], [...(found.get(m[0]) ?? []), file.replace(ROOT, "")]);
    }
    expect([...found.keys()].filter((s) => !allowed.has(s))).toEqual([]);
    for (const [s, files] of found) expect(files.every((f) => f.endsWith("src/lib/data-export/constants.ts") || /\/data-export\//.test(f) || /docs/.test(f)), `${s} is written outside the data-export code: ${files}`).toBe(true);
  });

  it("need no migration: admin_audit_log.action is text, and no migration puts a CHECK or an enum on it", () => {
    const dir = join(ROOT, "supabase/migrations");
    const base = readFileSync(join(dir, "0060_admin_identity.sql"), "utf8");
    expect(base).toMatch(/action text not null/);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8");
      expect(sql, `${f} constrains admin_audit_log.action`).not.toMatch(/admin_audit_log[\s\S]{0,200}check\s*\(\s*action/i);
      expect(sql, `${f} names an export action in a CHECK`).not.toMatch(/check\s*\([^)]*people\.export_/i);
    }
  });
});

describe("the fixed lists", () => {
  it("the refusal codes are exactly the list the owner approved", () => {
    expect([...REFUSAL_CODES]).toEqual(["in_progress", "live_export_exists", "own_account", "admin_target_needs_other_admin", "no_such_person", "not_a_uuid", "notice_failed", "not_cancellable"]);
  });

  it("the finish outcomes are the closed list", () => {
    expect([...FINISH_OUTCOMES]).toEqual(["completed", "failed", "refused", "superseded", "cancelled"]);
  });

  it("a ticket reference can hold neither an address nor a sentence", () => {
    for (const ok of ["SUP-1042", "ticket_77", "abc.def-9"]) expect(TICKET_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["jane@example.com", "two words", "x", "-leading", "a".repeat(41), "tab\tbed", "line\nbreak"]) expect(TICKET_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("the system actor", () => {
  it("is on a TLD that cannot be registered, has its own name, and is not the tooling sentinel", () => {
    expect(SYSTEM_DATA_EXPORT_ACTOR).toBe("system-data-export@talentrah.internal");
    expect(SYSTEM_DATA_EXPORT_ACTOR).toMatch(/^[a-z-]+@[a-z-]+\.internal$/);
    expect(SYSTEM_DATA_EXPORT_ACTOR).not.toBe(SYSTEM_TOOLING_ACTOR);
    expect(SYSTEM_TOOLING_ACTOR).toBe("system-tooling@talentrah.internal");
  });

  it("belongs to no operator", async () => {
    const { data, error } = await realService.from("admin_users").select("id").eq("email", SYSTEM_DATA_EXPORT_ACTOR);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("the strict writer", () => {
  const written: string[] = [];
  afterAll(async () => {
    flags.failAuditInsert = false;
    if (written.length) {
      const { error } = await realService.from("admin_audit_log").delete().in("id", written);
      expect(error).toBeNull();
    }
  });

  it("returns the new row's id", async () => {
    const id = await recordAdminActionStrict({ identity: { adminId: null, email: SYSTEM_DATA_EXPORT_ACTOR }, action: "people.export_requested", detail: { probe: true } });
    written.push(id);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const { data } = await realService.from("admin_audit_log").select("action, admin_email").eq("id", id).single();
    expect(data).toEqual({ action: "people.export_requested", admin_email: SYSTEM_DATA_EXPORT_ACTOR });
  });

  it("THROWS when the row cannot be written, where recordAdminAction swallows the same failure", async () => {
    flags.failAuditInsert = true;
    const input = { identity: { adminId: null, email: SYSTEM_DATA_EXPORT_ACTOR }, action: "people.export_requested" } as const;
    await expect(recordAdminActionStrict(input)).rejects.toBeInstanceOf(AdminAuditUnavailableError);
    await expect(recordAdminAction(input)).resolves.toBeUndefined();
    // and the thrown error names the action, not the database's message
    await expect(recordAdminActionStrict(input)).rejects.toThrow(/^the audit row people\.export_requested could not be written$/);
  });
});

describe("no helper copies a target that is not a uuid into a row (belt and braces: the start flow also nulls it first)", () => {
  afterEach(releaseCreated, 60_000);

  it("every helper that takes a target writes null for an email address, and the typed text is in no row", async () => {
    const a = await makeAdmin();
    const typed = "someone.private@example.com";
    const ids = [
      await auditRequested(a, { operation: "start", targetId: typed, ticket: "SUP-9001", reason: "access_request", requesterCheck: "contact_form" }),
      await auditFinished(a, { requestedId: "r", targetId: typed, outcome: "refused", refusalCode: "not_a_uuid" }),
      await auditNoticeSent(a, { requestedId: "r", targetId: typed, exportId: "e" }).then(() => null),
      await auditGenerated(a, { requestedId: "r", targetId: typed, exportId: "e", tables: 1, rows: 1, bytes: 1 }),
      await auditCancelled(a, { requestedId: "r", targetId: typed, exportId: "e" }),
      await auditDeleted({ exportId: typed, reason: "orphan", userId: typed }).then(() => null),
    ];
    const { data, error } = await realService.from("admin_audit_log").select("id, action, target_id, detail").like("action", "people.export_%").eq("admin_email", a.email);
    expect(error).toBeNull();
    const system = await realService.from("admin_audit_log").select("id, action, target_id, detail").eq("action", "people.export_deleted").order("created_at", { ascending: false }).limit(1);
    const rows = [...(data ?? []), ...(system.data ?? [])];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(rows)).not.toContain("someone.private");
    for (const r of rows) expect(r.target_id).toBeNull();
    const toDelete = [...ids.filter((x): x is string => !!x), ...(system.data ?? []).map((r) => r.id)];
    await realService.from("admin_audit_log").delete().in("id", toDelete);
  });
});
