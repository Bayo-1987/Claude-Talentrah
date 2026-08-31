/**
 * 0080/0081: the flag primitive, and the layer that cannot be skipped.
 *
 * The app refuses an unpermitted operator twice — the page guard and the
 * Server Action guard. This asserts the third: admin_set_feature_flag checks
 * the permission in the same statement as the write, so a future code path
 * that forgets to ask cannot flip a flag either.
 *
 * ASSERTIONS ARE ON THE ROW. A function can return ok:false having written
 * anyway; only re-reading `enabled` proves it did not.
 *
 * NOT ASSERTED, because it is not true: that a compromised service_role key is
 * stopped. It is not — that key can UPDATE feature_flags directly. Only
 * revoking its table privileges would change that, and the digest cron has to
 * read this table. The migration header says so.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

type Perm = Database["public"]["Enums"]["admin_permission"];
const RUN_TAG = randomUUID().slice(0, 8);
const tag = `${RUN_TAG}-${randomUUID().slice(0, 6)}`;

let holder: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let holderRole = "", strangerRole = "", flagKey = "";

async function makeRole(label: string, perms: Perm[]) {
  const { data, error } = await admin
    .from("admin_roles").insert({ name: `flags ${label} ${tag}` }).select("id").single();
  if (error) throw new Error(`fixture role: ${error.message}`);
  if (perms.length) {
    const { error: pe } = await admin.from("admin_role_permissions")
      .insert(perms.map((permission) => ({ role_id: data.id, permission })));
    if (pe) throw new Error(`fixture perms: ${pe.message}`);
  }
  return data.id;
}

beforeAll(async () => {
  [holder, stranger] = await Promise.all([
    createAuthedTestUser(`flags-holder-${RUN_TAG}`),
    createAuthedTestUser(`flags-stranger-${RUN_TAG}`),
  ]);
  holderRole = await makeRole("holder", ["feature_flags"]);
  strangerRole = await makeRole("stranger", ["operations"]);
  const { error } = await admin.from("admin_users").insert([
    { id: holder.id, email: holder.email.toLowerCase(), role_id: holderRole },
    { id: stranger.id, email: stranger.email.toLowerCase(), role_id: strangerRole },
  ]);
  if (error) throw new Error(`fixture operators: ${error.message}`);

  // ITS OWN FLAG, not the seeded job_match_digest — these tests flip what they
  // touch, and job_match_digest being off is a product decision somebody made.
  flagKey = `test_flag_${tag.replace(/-/g, "_")}`;
  const { error: fe } = await admin.from("feature_flags")
    .insert({ key: flagKey, label: `Test flag ${tag}`, enabled: false });
  if (fe) throw new Error(`fixture flag: ${fe.message}`);
});

afterAll(async () => {
  const ids = [holder?.id, stranger?.id].filter(Boolean) as string[];
  const { error: ae } = await admin.from("admin_audit_log").delete().in("admin_user_id", ids);
  if (ae) console.error("[flags cleanup] audit:", ae.message);
  if (flagKey) {
    const { error } = await admin.from("feature_flags").delete().eq("key", flagKey);
    if (error) console.error("[flags cleanup] flag:", error.message);
  }
  const { error: ue } = await admin.from("admin_users").delete().in("id", ids);
  if (ue) console.error("[flags cleanup] admin_users:", ue.message);
  await deleteTestUsers(ids);
  const { error } = await admin.from("admin_roles").delete().in("id", [holderRole, strangerRole]);
  if (error) console.error("[flags cleanup] roles:", error.message);
});

const flagState = async (key: string) =>
  (await admin.from("feature_flags").select("enabled, updated_by").eq("key", key).single()).data;

describe("0080/0081: the table is unreachable by any client", () => {
  it("a signed-in seeker cannot read or write feature_flags — refused by ERROR", async () => {
    const { data, error } = await stranger.client.from("feature_flags").select("*");
    expect(error, "LEAK: a client read feature_flags without error").not.toBeNull();
    expect(data ?? [], "LEAK: rows came back").toHaveLength(0);

    const { error: we } = await stranger.client
      .from("feature_flags").update({ enabled: true }).eq("key", flagKey);
    expect(we, "LEAK: a client wrote feature_flags").not.toBeNull();
    expect((await flagState(flagKey))?.enabled).toBe(false);
  });

  it("no client role may execute the setter", async () => {
    const { error } = await stranger.client.rpc("admin_set_feature_flag", {
      p_actor: holder.id, p_key: flagKey, p_enabled: true,
    });
    expect(error, "LEAK: a client executed admin_set_feature_flag").not.toBeNull();
  });
});

describe("0081: the permission is checked in the same statement as the write", () => {
  it("an operator without feature_flags is refused, and the flag does not move", async () => {
    const { data } = await admin.rpc("admin_set_feature_flag", {
      p_actor: stranger.id, p_key: flagKey, p_enabled: true,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");

    const after = await flagState(flagKey);
    expect(after?.enabled, "LEAK: an unauthorised actor switched a feature on").toBe(false);
    expect(after?.updated_by, "LEAK: an unauthorised actor was recorded as the changer").toBeNull();
  });

  it("a holder can switch it on and off, and is recorded", async () => {
    const on = await admin.rpc("admin_set_feature_flag", {
      p_actor: holder.id, p_key: flagKey, p_enabled: true,
    });
    expect(on.data?.[0]?.ok, on.data?.[0]?.reason).toBe(true);
    const afterOn = await flagState(flagKey);
    expect(afterOn?.enabled).toBe(true);
    expect(afterOn?.updated_by, "the changer must be recorded").toBe(holder.id);

    const off = await admin.rpc("admin_set_feature_flag", {
      p_actor: holder.id, p_key: flagKey, p_enabled: false,
    });
    expect(off.data?.[0]?.ok, off.data?.[0]?.reason).toBe(true);
    expect((await flagState(flagKey))?.enabled).toBe(false);
  });

  it("an unknown key is refused rather than silently creating a flag", async () => {
    const bogus = `no_such_flag_${randomUUID().slice(0, 8)}`;
    const { data } = await admin.rpc("admin_set_feature_flag", {
      p_actor: holder.id, p_key: bogus, p_enabled: true,
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("unknown_flag");

    const { data: created } = await admin.from("feature_flags").select("key").eq("key", bogus);
    expect(created, "LEAK: a flag was created from a typo'd key").toHaveLength(0);
  });
});

describe("0080: the shipped state is OFF", () => {
  it("job_match_digest exists and is off, because that is the decision", async () => {
    const { data } = await admin
      .from("feature_flags").select("key, label, enabled").eq("key", "job_match_digest").single();
    expect(data?.label).toBe("Job-match digest emails");
    expect(data?.enabled, "the digest must ship switched off").toBe(false);
  });

  it("the column default is false, so a flag added without saying is off", async () => {
    const key = `default_probe_${tag.replace(/-/g, "_")}`;
    const { error } = await admin.from("feature_flags").insert({ key, label: "Default probe" });
    expect(error).toBeNull();
    const { data } = await admin.from("feature_flags").select("enabled").eq("key", key).single();
    expect(data?.enabled, "a flag with no explicit state must default to off").toBe(false);
    await admin.from("feature_flags").delete().eq("key", key);
  });
});
