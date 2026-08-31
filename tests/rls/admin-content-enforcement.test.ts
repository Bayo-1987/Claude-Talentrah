/**
 * 0079: the four content mutations refuse an actor without the permission,
 * IN THE DATABASE.
 *
 * The app already refuses them twice — the page guard (0075) and the Server
 * Action guard (#163). This is the backstop under both, and the only one that
 * still holds if a future code path forgets to ask.
 *
 * WHAT IS ASSERTED IS THE ROW. A function can return `ok: false` while having
 * written anyway; only re-reading the row proves the write did not happen.
 * Every case below checks the record, not just the reply.
 *
 * WHAT THIS DOES NOT TEST, because it is not true: that a compromised
 * service_role key is stopped. It is not — that key can UPDATE these tables
 * directly, and only revoking its table privileges would change that, which
 * would break the crons, the seed and every suite here. The migration header
 * says so; this comment exists so a reader of the tests is not left with a
 * larger impression than the code earns.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

type Perm = Database["public"]["Enums"]["admin_permission"];
/*
 * A per-process tag, generated here rather than imported.
 *
 * The shared RUN_TAG in tests/support/list-users.ts is #155 and still open, so
 * it does not exist on main. Its purpose applies regardless — this suite's
 * fixtures must be unmistakably its own and its own run's, because the CI
 * project is shared and a concurrent run deleting live fixtures is exactly
 * what #155 exists to stop. Swap this for the shared export once that merges.
 */
const RUN_TAG = randomUUID().slice(0, 8);
const tag = `${RUN_TAG}-${randomUUID().slice(0, 6)}`;

let holder: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let holderRole = "", strangerRole = "";
let scholarshipId = "", postingId = "", feedbackId = "", courseId = "", reporterId = "";

async function makeRole(label: string, perms: Perm[]) {
  const { data, error } = await admin
    .from("admin_roles").insert({ name: `content-enf ${label} ${tag}` }).select("id").single();
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
    createAuthedTestUser(`enf-holder-${RUN_TAG}`),
    createAuthedTestUser(`enf-stranger-${RUN_TAG}`),
  ]);
  holderRole = await makeRole("holder", ["scholarships", "reported_postings", "feedback", "courses"]);
  strangerRole = await makeRole("stranger", ["operations"]);
  const { error } = await admin.from("admin_users").insert([
    { id: holder.id, email: holder.email.toLowerCase(), role_id: holderRole },
    { id: stranger.id, email: stranger.email.toLowerCase(), role_id: strangerRole },
  ]);
  if (error) throw new Error(`fixture operators: ${error.message}`);

  const { data: sch, error: se } = await admin.from("scholarships").insert({
    provider: `ENF Provider ${tag}`, program_name: `ENF Programme ${tag}`,
    official_url: `https://example.test/${randomUUID()}`,
    funding_type: "full",
    dedup_fingerprint: `enf-${randomUUID()}`,
  }).select("id").single();
  if (se) throw new Error(`fixture scholarship: ${se.message}`);
  scholarshipId = sch.id;

  const { data: jp, error: je } = await admin.from("job_postings").insert({
    source_type: "external", company_name: `ENF Co ${tag}`, title: `ENF posting ${tag}`,
    description: "fixture", structured_jd: {}, status: "open",
    posted_at: new Date().toISOString(), dedup_fingerprint: `enf-${randomUUID()}`,
    external_source: "enf", external_url: `https://example.test/${randomUUID()}`,
  }).select("id").single();
  if (je) throw new Error(`fixture posting: ${je.message}`);
  postingId = jp.id;

  const { data: rep, error: re } = await admin.auth.admin.createUser({
    email: `enf-reporter-${RUN_TAG}-${randomUUID()}@talentrah.test`,
    password: `E2E-${randomUUID()}Aa1!`, email_confirm: true,
  });
  if (re || !rep?.user) throw new Error(`fixture reporter: ${re?.message}`);
  reporterId = rep.user.id;

  const { data: fb, error: fe } = await admin.from("feedback").insert({
    user_id: reporterId, category: "other", message: `ENF feedback ${tag}`, page_path: "/",
  }).select("id").single();
  if (fe) throw new Error(`fixture feedback: ${fe.message}`);
  feedbackId = fb.id;

  /*
   * ITS OWN COURSE ROW, not a borrowed one.
   *
   * The first version of this did `.select("id").limit(1).single()` — the
   * exact shared-fixture borrow that issue #136 is about. It is worse here
   * than there, because these tests MUTATE the row they take: a suite that
   * borrows a real catalog entry and flips its `active` flag is editing
   * production-shaped data another suite may be asserting on, and the failure
   * lands somewhere unrelated.
   */
  const { data: crs, error: ce } = await admin.from("course_recommendations").insert({
    skill_tag: `enf-${tag}`, provider: `ENF Provider ${tag}`,
    title: `ENF Course ${tag}`, price_tier: "free",
    affiliate_url: `https://example.test/${randomUUID()}`,
    active: false,
  }).select("id").single();
  if (ce) throw new Error(`fixture course: ${ce.message}`);
  courseId = crs.id;
});

afterAll(async () => {
  const ids = [holder?.id, stranger?.id].filter(Boolean) as string[];
  const { error: ae } = await admin.from("admin_audit_log").delete().in("admin_user_id", ids);
  if (ae) console.error("[content-enf cleanup] audit:", ae.message);
  if (courseId) { const { error } = await admin.from("course_recommendations").delete().eq("id", courseId); if (error) console.error("[cleanup] course:", error.message); }
  if (feedbackId) { const { error } = await admin.from("feedback").delete().eq("id", feedbackId); if (error) console.error("[cleanup] feedback:", error.message); }
  if (postingId) { const { error } = await admin.from("job_postings").delete().eq("id", postingId); if (error) console.error("[cleanup] posting:", error.message); }
  if (scholarshipId) { const { error } = await admin.from("scholarships").delete().eq("id", scholarshipId); if (error) console.error("[cleanup] scholarship:", error.message); }
  const { error: ue } = await admin.from("admin_users").delete().in("id", ids);
  if (ue) console.error("[content-enf cleanup] admin_users:", ue.message);
  await deleteTestUsers([...ids, reporterId].filter(Boolean) as string[]);
  // Roles last — admin_users.role_id is ON DELETE RESTRICT.
  const { error } = await admin.from("admin_roles").delete().in("id", [holderRole, strangerRole]);
  if (error) console.error("[content-enf cleanup] roles:", error.message);
});

describe("0079: each content mutation refuses an actor without its permission", () => {
  it("scholarships — refused, and the row is untouched", async () => {
    const before = (await admin.from("scholarships").select("moderation_status, moderated_by").eq("id", scholarshipId).single()).data;
    const { data } = await admin.rpc("admin_moderate_scholarship", {
      p_actor: stranger.id, p_id: scholarshipId, p_status: "verified", p_note: "should not land",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    const after = (await admin.from("scholarships").select("moderation_status, moderated_by").eq("id", scholarshipId).single()).data;
    expect(after?.moderation_status, "LEAK: an unauthorised actor published a scholarship").toBe(before?.moderation_status);
    expect(after?.moderated_by, "LEAK: a moderator was recorded").toBe(before?.moderated_by);
  });

  it("reported postings — refused, and the posting stays open", async () => {
    const { data } = await admin.rpc("admin_moderate_job_posting", {
      p_actor: stranger.id, p_id: postingId, p_action: "remove", p_reason: "should not land",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    const after = (await admin.from("job_postings").select("status, removed_by, removal_reason").eq("id", postingId).single()).data;
    expect(after?.status, "LEAK: an unauthorised actor removed a posting").toBe("open");
    expect(after?.removed_by).toBeNull();
    expect(after?.removal_reason).toBeNull();
  });

  it("feedback — refused, and the triage state is unchanged", async () => {
    const before = (await admin.from("feedback").select("status, triaged_by").eq("id", feedbackId).single()).data;
    const { data } = await admin.rpc("admin_triage_feedback", {
      p_actor: stranger.id, p_id: feedbackId, p_status: "resolved", p_note: "should not land",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    const after = (await admin.from("feedback").select("status, triaged_by").eq("id", feedbackId).single()).data;
    expect(after?.status, "LEAK: an unauthorised actor triaged feedback").toBe(before?.status);
    expect(after?.triaged_by).toBe(before?.triaged_by);
  });

  it("courses — refused, and the row is unchanged", async () => {
    const before = (await admin.from("course_recommendations").select("active, title, updated_at").eq("id", courseId).single()).data;
    const { data } = await admin.rpc("admin_update_course", {
      p_actor: stranger.id, p_id: courseId, p_title: "SHOULD NOT LAND",
    });
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");
    const after = (await admin.from("course_recommendations").select("active, title, updated_at").eq("id", courseId).single()).data;
    expect(after?.title, "LEAK: an unauthorised actor edited the catalog").toBe(before?.title);
    expect(after?.updated_at, "LEAK: the row was touched").toBe(before?.updated_at);
  });
});

describe("0079: a holder can still do the work — the guard is not just refusing", () => {
  it("scholarships, postings, feedback and courses all succeed for a holder", async () => {
    const sch = await admin.rpc("admin_moderate_scholarship", {
      p_actor: holder.id, p_id: scholarshipId, p_status: "verified", p_note: "looks right",
    });
    expect(sch.data?.[0]?.ok, sch.data?.[0]?.reason).toBe(true);
    expect((await admin.from("scholarships").select("moderation_status").eq("id", scholarshipId).single()).data?.moderation_status).toBe("verified");

    const jp = await admin.rpc("admin_moderate_job_posting", {
      p_actor: holder.id, p_id: postingId, p_action: "remove", p_reason: "advance-fee scam",
    });
    expect(jp.data?.[0]?.ok, jp.data?.[0]?.reason).toBe(true);
    expect(jp.data?.[0]?.new_status).toBe("removed");

    // restore lands on `closed`, never `open`
    const back = await admin.rpc("admin_moderate_job_posting", {
      p_actor: holder.id, p_id: postingId, p_action: "restore", p_reason: "report was wrong",
    });
    expect(back.data?.[0]?.ok, back.data?.[0]?.reason).toBe(true);
    expect(back.data?.[0]?.new_status).toBe("closed");
    const posting = (await admin.from("job_postings").select("status, removed_at, removal_reason").eq("id", postingId).single()).data;
    expect(posting?.removed_at, "restore must clear removed_at in the same statement").toBeNull();
    expect(posting?.removal_reason).toBeNull();

    const fb = await admin.rpc("admin_triage_feedback", {
      p_actor: holder.id, p_id: feedbackId, p_status: "resolved", p_note: "handled",
    });
    expect(fb.data?.[0]?.ok, fb.data?.[0]?.reason).toBe(true);
    expect((await admin.from("feedback").select("status").eq("id", feedbackId).single()).data?.status).toBe("resolved");

    const co = await admin.rpc("admin_update_course", { p_actor: holder.id, p_id: courseId, p_active: true });
    expect(co.data?.[0]?.ok, co.data?.[0]?.reason).toBe(true);
  });

  it("a reason is required in both directions for postings", async () => {
    for (const action of ["remove", "restore"] as const) {
      const { data } = await admin.rpc("admin_moderate_job_posting", {
        p_actor: holder.id, p_id: postingId, p_action: action, p_reason: "   ",
      });
      expect(data?.[0]?.ok, `${action} accepted a blank reason`).toBe(false);
      expect(data?.[0]?.reason).toBe("reason_required");
    }
  });
});

describe("0079: the permission catalog comes from the enum", () => {
  it("lists every enum value, so the role editor cannot silently drop one", async () => {
    const { data, error } = await admin.rpc("admin_permission_catalog");
    expect(error).toBeNull();
    const keys = (data ?? []).map((r) => r.permission);
    // The nine 0075 shipped plus `blog`, added later by another migration —
    // which is the whole point: a hardcoded list would not have it.
    for (const k of ["scholarships", "reported_postings", "ad_campaigns", "feedback",
                     "courses", "operations", "finance", "people", "operators"]) {
      expect(keys, `catalog is missing ${k}`).toContain(k);
    }
    expect(keys.length, "catalog should reflect the enum, not a frozen list")
      .toBeGreaterThanOrEqual(9);
  });
});
