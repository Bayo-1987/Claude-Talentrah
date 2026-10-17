/**
 * Fixtures for the DB-backed data export suites (tests/data-export/*): a throwaway admin and person, a fake mailer, a service-client wrapper that counts reads and can fail on demand,
 * and the cleanup that leaves the local database as it found it. Everything runs against the local stack (tests/setup.ts refuses any other target).
 *
 * The person has a DISTINCTIVE name and address so a test can assert that neither string is in any audit row.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { DATA_EXPORT_BUCKET } from "@/lib/data-export/constants";
import type { Admin } from "@/lib/data-export/audit";
import type { StartDeps } from "@/lib/data-export/start";
import { admin as service, createTestUser, deleteTestUsers } from "./auth";

export const PERSON_FIRST_NAME = "Zephyrine";
export const PERSON_LAST_NAME = "Quillfeather";

/** Flags the service-client wrapper (and the mocked createServiceRoleClient) read. */
export const flags = { failAuditInsert: false, failRemove: 0 };

export interface Mailed {
  template: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function fakeMailer(opts: { failTemplates?: string[]; gates?: Record<string, Promise<void>> } = {}) {
  const sent: Mailed[] = [];
  const send: StartDeps["send"] = async (template, payload) => {
    if (opts.gates?.[template]) await opts.gates[template];
    if (opts.failTemplates?.includes(template)) return { error: { message: "forced failure" } };
    sent.push({ template, ...payload });
    return { error: null };
  };
  return { sent, send };
}

export interface Person {
  id: string;
  email: string;
}
const people: Person[] = [];
const admins: Array<{ id: string; email: string }> = [];
const startedAt = new Date(Date.now() - 5_000).toISOString();

export async function makePerson(extra: { pendingDeletion?: boolean } = {}): Promise<Person> {
  const u = await createTestUser("dx-person", { first_name: PERSON_FIRST_NAME, last_name: PERSON_LAST_NAME });
  people.push(u);
  const patch: { first_name: string; last_name: string; deletion_requested_at?: string } = { first_name: PERSON_FIRST_NAME, last_name: PERSON_LAST_NAME };
  if (extra.pendingDeletion) patch.deletion_requested_at = new Date().toISOString();
  const { error } = await service.from("profiles").update(patch).eq("id", u.id);
  if (error) throw new Error(`makePerson: ${error.message}`);
  return u;
}

export async function makeAdmin(): Promise<Admin> {
  const u = await createTestUser("dx-admin");
  const { error } = await service.from("admin_users").upsert({ id: u.id, email: `ops-${randomUUID()}@talentrah.test`, display_name: "Export test admin" });
  if (error) throw new Error(`makeAdmin: ${error.message}`);
  const { data } = await service.from("admin_users").select("email").eq("id", u.id).single();
  admins.push({ id: u.id, email: data!.email });
  return { adminId: u.id, email: data!.email, sessionId: null };
}

/** The service client, wrapped: counts `from()` calls per table, and fails admin_audit_log inserts (flags.failAuditInsert) and storage removes (flags.failRemove) on demand. */
export function countedService(): { client: SupabaseClient<Database>; reads: string[] } {
  const reads: string[] = [];
  const client = new Proxy(service, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          reads.push(table);
          return failingAudit(table) ?? target.from(table as never);
        };
      }
      if (prop === "storage") {
        return {
          from: (bucket: string) => {
            const real = target.storage.from(bucket);
            return new Proxy(real, {
              get(t, p, r) {
                if (p === "remove") {
                  return async (paths: string[]) => {
                    if (flags.failRemove > 0) {
                      flags.failRemove -= 1;
                      return { data: null, error: { message: "forced storage failure" } };
                    }
                    return t.remove(paths);
                  };
                }
                const v = Reflect.get(t, p, r);
                return typeof v === "function" ? v.bind(t) : v;
              },
            });
          },
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as SupabaseClient<Database>;
  return { client, reads };
}

/** A stand-in for `from("admin_audit_log")` that refuses inserts while flags.failAuditInsert is set; null otherwise (use the real table). */
export function failingAudit(table: string): unknown {
  if (table !== "admin_audit_log" || !flags.failAuditInsert) return null;
  const error = { code: "XX000", message: "forced audit failure" };
  const result = { data: null, error };
  const chain: Record<string, unknown> = {
    select: () => ({ single: async () => result }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return { insert: () => chain };
}

export async function auditRowsSince(): Promise<Array<{ id: string; action: string; admin_email: string | null; admin_user_id: string | null; target_table: string | null; target_id: string | null; detail: Record<string, unknown> | null }>> {
  const { data, error } = await service.from("admin_audit_log").select("id, action, admin_email, admin_user_id, target_table, target_id, detail, created_at").like("action", "people.export_%").gte("created_at", startedAt).order("created_at", { ascending: true });
  if (error) throw new Error(`auditRowsSince: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, detail: (r.detail as Record<string, unknown> | null) ?? null }));
}

export async function bucketPaths(): Promise<string[]> {
  const out: string[] = [];
  const bucket = service.storage.from(DATA_EXPORT_BUCKET);
  const root = await bucket.list("", { limit: 1000 });
  for (const e of root.data ?? []) {
    if (e.id === null) {
      const inner = await bucket.list(e.name, { limit: 1000 });
      for (const f of inner.data ?? []) out.push(`${e.name}/${f.name}`);
    } else out.push(e.name);
  }
  return out;
}

/** Puts an object in the bucket the way the app does (a Blob WITH its type: the bucket only accepts application/json) and FAILS the test if it did not land. */
export async function putObject(path: string, body = "{}"): Promise<void> {
  const { error } = await service.storage.from(DATA_EXPORT_BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: false });
  if (error) throw new Error(`putObject ${path}: ${error.message}`);
}

export async function emptyBucket(): Promise<void> {
  const paths = await bucketPaths();
  if (paths.length === 0) return;
  const { error } = await service.storage.from(DATA_EXPORT_BUCKET).remove(paths);
  if (error) throw new Error(`emptyBucket: ${error.message}`);
}

/**
 * Gives back the accounts the test just made (pooled test users are RELEASED, not deleted). Called after every test so a file never holds more than a few of the pool's 40 at once:
 * holding dozens until the end of the file starves other files that run in parallel (tests/support/test-user-pool.test.ts failed under exactly that).
 */
export async function releaseCreated(): Promise<void> {
  for (const p of people) {
    const { error } = await service.from("data_export_files").delete().eq("user_id", p.id);
    if (error) throw new Error(`release data_export_files: ${error.message}`);
  }
  for (const a of admins) {
    const { error } = await service.from("admin_users").delete().eq("id", a.id);
    if (error) throw new Error(`release admin_users: ${error.message}`);
  }
  await deleteTestUsers([...people.map((p) => p.id), ...admins.map((a) => a.id)]);
  people.length = 0;
  admins.length = 0;
}

export async function cleanupAll(): Promise<void> {
  flags.failAuditInsert = false;
  flags.failRemove = 0;
  await emptyBucket();
  await releaseCreated();
  const { error: auditError } = await service.from("admin_audit_log").delete().like("action", "people.export_%").gte("created_at", startedAt);
  if (auditError) throw new Error(`cleanup admin_audit_log: ${auditError.message}`);
}
