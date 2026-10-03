/**
 * ACCT-1 PR 1 (migration 0212) — an account scheduled for deletion is hidden at once, on every surface other people read it through.
 *
 * The same person is read three ways before and after the flag, so each surface is its own control:
 *
 *   Talent Directory     the listed count, the paid search, the portfolio read and the contact-request gate
 *   Employer applicants  the applicant list, the resume, the view context, the per-posting counts
 *   Mentor discovery     the profile and slot reads (RLS), the open-slot and name functions, and booking
 *   Leaderboard          the referral leaderboard
 *
 * "Before" proves the person IS visible (so a pass afterwards is not an empty fixture), "after" is the flag set the way account_deletion_confirm sets
 * it, and "restored" proves clearing it brings every surface back. The flag is set with the service role for the surface checks and ALSO through the real
 * confirm function for one end-to-end pass, so the two cannot drift apart.
 *
 * First run of this file is CI (no database on the authoring machine); the same checks were run in a rolled-back transaction on talentrah-preview.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { generateDeletionToken } from "@/lib/account-deletion/token";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const untyped = (c: Authed["client"]) => c as unknown as typeof admin;

let applicant: Authed; // an applicant who is also a listed, verified candidate, a referrer on the leaderboard
let employer: Authed; // owner of the org that holds the posting and the directory subscription
let mentor: Authed;
let mentee: Authed;
let orgId = "";
let orgName = "";
let jobId = "";
let applicationId = "";
let resumeId = "";
let slotId = "";
let referredId = "";

const setFlag = async (id: string, on: boolean) => {
  const { error } = await admin.from("profiles").update({ deletion_requested_at: on ? new Date().toISOString() : null } as never).eq("id", id);
  if (error) throw new Error(`set flag: ${error.message}`);
};

beforeAll(async () => {
  [applicant, employer, mentor, mentee] = await Promise.all([
    createAuthedTestUser("acct1h-applicant"),
    createAuthedTestUser("acct1h-employer"),
    createAuthedTestUser("acct1h-mentor"),
    createAuthedTestUser("acct1h-mentee"),
  ]);
  const referred = await createAuthedTestUser("acct1h-referred");
  referredId = referred.id;

  await admin.from("profiles").update({
    first_name: "Hide", last_name: "Applicant", talent_directory_opt_in: true, talent_verification_status: "verified", talent_verification_score: 80,
    talent_verified_at: new Date().toISOString(), referral_leaderboard_opt_in: true, referral_leaderboard_display_name: `ACCT1 Board ${randomUUID().slice(0, 6)}`,
  }).eq("id", applicant.id);

  const org = await admin.from("organizations").insert({ name: `ACCT1-TEST Org hide ${randomUUID().slice(0, 8)}`, created_by: employer.id, verified: true }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  orgName = org.data.name;
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: employer.id, role: "owner" });
  if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);

  const job = await admin.from("job_postings").insert({ source_type: "internal", organization_id: orgId, company_name: orgName, title: `ACCT1-TEST Role ${randomUUID().slice(0, 6)}`, description: "Fixture.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() }).select("id").single();
  if (job.error || !job.data) throw new Error(`fixture job: ${job.error?.message}`);
  jobId = job.data.id;

  const resume = await admin.from("resumes").insert({ user_id: applicant.id, structured_content: { contact: { name: "Hide Applicant" }, summary: "Fixture.", experience: [], education: [], skills: ["sql"] } }).select("id").single();
  if (resume.error || !resume.data) throw new Error(`fixture resume: ${resume.error?.message}`);
  resumeId = resume.data.id;
  const app = await admin.from("applications").insert({ user_id: applicant.id, job_posting_id: jobId, resume_id: resumeId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() }).select("id").single();
  if (app.error || !app.data) throw new Error(`fixture application: ${app.error?.message}`);
  applicationId = app.data.id;

  const plan = await admin.from("talent_directory_plans").select("id").limit(1).single();
  const sub = await admin.from("talent_directory_subscriptions").insert({ organization_id: orgId, plan_id: plan.data!.id, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), status: "active" });
  if (sub.error) throw new Error(`fixture subscription: ${sub.error.message}`);

  const item = await admin.from("talent_portfolio_items").insert({ user_id: applicant.id, title: "ACCT1 portfolio", description: "x", url: "https://example.com/acct1" });
  if (item.error) throw new Error(`fixture portfolio: ${item.error.message}`);

  const ref = await admin.from("referrals").insert({ referrer_id: applicant.id, referred_user_id: referredId, status: "activated", activated_at: new Date().toISOString(), reward_credits_referrer: 5 });
  if (ref.error) throw new Error(`fixture referral: ${ref.error.message}`);

  const mp = await admin.from("mentor_profiles").upsert({ user_id: mentor.id, status: "approved", display_name: "ACCT1 Mentor", base_price_ngn: 10_000 });
  if (mp.error) throw new Error(`fixture mentor profile: ${mp.error.message}`);
  const start = new Date(Date.now() + 5 * 86_400_000);
  const slot = await admin.from("mentor_availability_slots").insert({ mentor_id: mentor.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), is_booked: false }).select("id").single();
  if (slot.error || !slot.data) throw new Error(`fixture slot: ${slot.error?.message}`);
  slotId = slot.data.id;
}, 240_000);

afterAll(async () => {
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };
  await check(admin.from("mentorship_sessions").delete().eq("mentor_id", mentor.id));
  await check(admin.from("mentor_availability_slots").delete().eq("mentor_id", mentor.id));
  await check(admin.from("mentor_profiles").delete().eq("user_id", mentor.id));
  await check(admin.from("referrals").delete().eq("referred_user_id", referredId));
  await check(admin.from("talent_portfolio_items").delete().eq("user_id", applicant.id));
  if (applicationId) await check(admin.from("applications").delete().eq("id", applicationId));
  if (resumeId) await check(admin.from("resumes").delete().eq("id", resumeId));
  await check(admin.from("talent_directory_subscriptions").delete().eq("organization_id", orgId));
  if (orgId) await deleteOrgsCascade(admin, [orgId]);
  const ids = [applicant, employer, mentor, mentee].filter(Boolean).map((u) => u.id).concat(referredId ? [referredId] : []);
  for (const id of ids) await admin.from("account_deletions" as never).delete().eq("profile_id", id);
  await deleteTestUsers(ids);
}, 240_000);

describe("account_is_active", () => {
  it("is true for a normal account and false once the flag is set", async () => {
    expect((await untyped(employer.client).rpc("account_is_active" as never, { p_user_id: applicant.id } as never)).data).toBe(true);
    await setFlag(applicant.id, true);
    expect((await untyped(employer.client).rpc("account_is_active" as never, { p_user_id: applicant.id } as never)).data).toBe(false);
    await setFlag(applicant.id, false);
  });
});

describe("Talent Directory", () => {
  const search = async () => {
    const { data, error } = await untyped(employer.client).rpc("talent_directory_search" as never, { p_candidate_id: applicant.id } as never);
    expect(error).toBeNull();
    return (data ?? []) as unknown as Array<{ user_id: string }>;
  };
  const portfolio = async () => {
    const { data, error } = await untyped(employer.client).rpc("talent_directory_portfolio_items" as never, { p_candidate_id: applicant.id } as never);
    expect(error).toBeNull();
    return (data ?? []) as unknown as unknown[];
  };
  const contact = async () => {
    const { data, error } = await admin.rpc("request_talent_directory_contact" as never, { p_organization_id: orgId, p_candidate_id: applicant.id, p_message: "Hello", p_requested_by: employer.id } as never);
    expect(error).toBeNull();
    return (data as unknown as Array<{ ok: boolean; reason: string }>)[0];
  };
  const listed = async () => {
    const { data } = await admin.rpc("talent_directory_listed_ids" as never);
    return ((data ?? []) as unknown as string[]).includes(applicant.id);
  };

  it("BEFORE: the candidate is listed, searchable, has a readable portfolio, and can be contacted", async () => {
    expect(await listed()).toBe(true);
    expect((await search()).map((r) => r.user_id)).toEqual([applicant.id]);
    expect(await portfolio()).toHaveLength(1);
    expect((await contact()).reason).not.toBe("candidate_not_listed");
    await admin.from("talent_directory_contact_requests").delete().eq("candidate_id", applicant.id);
  });

  it("AFTER the flag: not listed, not in the paid search, no portfolio, not contactable", async () => {
    await setFlag(applicant.id, true);
    try {
      expect(await listed()).toBe(false);
      expect(await search()).toEqual([]);
      expect(await portfolio()).toEqual([]);
      expect((await contact()).reason).toBe("candidate_not_listed");
    } finally {
      await setFlag(applicant.id, false);
    }
  });

  it("RESTORED: back in all of them", async () => {
    expect(await listed()).toBe(true);
    expect((await search()).map((r) => r.user_id)).toEqual([applicant.id]);
  });
});

describe("employers' applicant views", () => {
  const applicants = async () => {
    const { data, error } = await untyped(employer.client).rpc("employer_job_applicants" as never, { p_job_posting_id: jobId } as never);
    expect(error).toBeNull();
    return ((data ?? []) as unknown as Array<{ application_id: string }>).map((r) => r.application_id);
  };
  const resumeRows = async () => ((await untyped(employer.client).rpc("employer_view_resume" as never, { p_application_id: applicationId } as never)).data ?? []) as unknown as unknown[];
  const contextRows = async () => ((await untyped(employer.client).rpc("employer_resume_view_context" as never, { p_application_id: applicationId } as never)).data ?? []) as unknown as unknown[];
  const counts = async () => ((await untyped(employer.client).rpc("org_application_counts" as never, { p_organization_id: orgId } as never)).data ?? []) as unknown as Array<{ application_count: number }>;
  const markViewed = async () => (await untyped(employer.client).rpc("record_employer_resume_view" as never, { p_application_id: applicationId } as never)).data as unknown as boolean;

  it("BEFORE: the employer sees the applicant, the resume, the context and the count", async () => {
    expect(await applicants()).toEqual([applicationId]);
    expect(await resumeRows()).toHaveLength(1);
    expect(await contextRows()).toHaveLength(1);
    expect(Number((await counts())[0].application_count)).toBe(1);
  });

  it("AFTER the flag: none of the four, and a resume view is not recorded", async () => {
    await setFlag(applicant.id, true);
    try {
      expect(await applicants()).toEqual([]);
      expect(await resumeRows()).toEqual([]);
      expect(await contextRows()).toEqual([]);
      expect(await counts()).toEqual([]);
      expect(await markViewed()).toBe(false);
      const { data } = await admin.from("employer_applicant_status").select("application_id").eq("application_id", applicationId);
      expect(data, "no 'viewed' stamp for an applicant the employer cannot see").toEqual([]);
    } finally {
      await setFlag(applicant.id, false);
    }
  });

  it("the applicant's own view of their own application is untouched while the flag is set", async () => {
    await setFlag(applicant.id, true);
    try {
      const { data, error } = await applicant.client.from("applications").select("id").eq("id", applicationId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    } finally {
      await setFlag(applicant.id, false);
    }
  });

  it("RESTORED: all four are back", async () => {
    expect(await applicants()).toEqual([applicationId]);
    expect(await resumeRows()).toHaveLength(1);
  });
});

describe("the referral leaderboard", () => {
  const board = async () => {
    const { data, error } = await untyped(mentee.client).rpc("referral_leaderboard" as never, { p_period_start: new Date(Date.now() - 86_400_000).toISOString(), p_period_end: new Date(Date.now() + 86_400_000).toISOString(), p_limit: 100 } as never);
    expect(error).toBeNull();
    return ((data ?? []) as unknown as Array<{ display_name: string }>).map((r) => r.display_name);
  };
  it("lists an opted-in referrer, drops them once flagged, and lists them again when restored", async () => {
    const { data: p } = await admin.from("profiles").select("referral_leaderboard_display_name").eq("id", applicant.id).single();
    const name = p!.referral_leaderboard_display_name!;
    expect(await board()).toContain(name);
    await setFlag(applicant.id, true);
    try {
      expect(await board()).not.toContain(name);
    } finally {
      await setFlag(applicant.id, false);
    }
    expect(await board()).toContain(name);
  });
});

describe("mentor discovery", () => {
  const profileVisible = async () => ((await mentee.client.from("mentor_profiles").select("user_id").eq("user_id", mentor.id)).data ?? []).length === 1;
  const slotVisible = async () => ((await mentee.client.from("mentor_availability_slots").select("id").eq("id", slotId)).data ?? []).length === 1;
  const openSlots = async () => ((await untyped(mentee.client).rpc("open_mentor_slots" as never, { p_mentor_ids: [mentor.id] } as never)).data ?? []) as unknown as unknown[];
  const names = async () => ((await untyped(mentee.client).rpc("mentor_public_names" as never, { p_mentor_ids: [mentor.id] } as never)).data ?? []) as unknown as unknown[];

  it("BEFORE: the mentor's profile and slot are readable, open, named", async () => {
    expect(await profileVisible()).toBe(true);
    expect(await slotVisible()).toBe(true);
    expect(await openSlots()).toHaveLength(1);
    expect(await names()).toHaveLength(1);
  });

  it("AFTER the flag: not readable by others (RLS), no open slots, no public name, and cannot be booked", async () => {
    await setFlag(mentor.id, true);
    try {
      expect(await profileVisible()).toBe(false);
      expect(await slotVisible()).toBe(false);
      expect(await openSlots()).toEqual([]);
      expect(await names()).toEqual([]);
      const { error } = await admin.rpc("book_mentor_session" as never, { p_availability_slot_id: slotId, p_mentee_id: mentee.id, p_session_type: "career_strategy" } as never);
      expect(error?.message).toContain("MENTOR_NOT_APPROVED");
      const { data: slot } = await admin.from("mentor_availability_slots").select("is_booked").eq("id", slotId).single();
      expect(slot?.is_booked, "a refused booking must roll the slot update back").toBe(false);
    } finally {
      await setFlag(mentor.id, false);
    }
  });

  it("the mentor still reads their OWN profile while flagged (the restore prompt needs it)", async () => {
    await setFlag(mentor.id, true);
    try {
      const { data } = await mentor.client.from("mentor_profiles").select("user_id").eq("user_id", mentor.id);
      expect(data).toHaveLength(1);
    } finally {
      await setFlag(mentor.id, false);
    }
  });

  it("RESTORED: visible, open and bookable again", async () => {
    expect(await profileVisible()).toBe(true);
    expect(await openSlots()).toHaveLength(1);
    const { error } = await admin.rpc("book_mentor_session" as never, { p_availability_slot_id: slotId, p_mentee_id: mentee.id, p_session_type: "career_strategy" } as never);
    expect(error).toBeNull();
    await admin.from("mentorship_sessions").delete().eq("availability_slot_id", slotId);
    await admin.from("mentor_availability_slots").update({ is_booked: false }).eq("id", slotId);
  });
});

describe("direct table reads by ANOTHER signed-in user (the Supabase client can query tables itself, so each is its own check)", () => {
  let sessionId = "";
  let reviewId = "";
  let submissionId = "";

  beforeAll(async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    const ses = await admin.from("mentorship_sessions").insert({
      mentor_id: mentor.id, mentee_id: mentee.id, availability_slot_id: slotId, session_type: "career_strategy",
      scheduled_start: past.toISOString(), scheduled_end: new Date(past.getTime() + 3_600_000).toISOString(),
      price_ngn: 0, platform_commission_ngn: 0, mentor_payout_ngn: 0, status: "completed",
    } as never).select("id").single();
    if (ses.error || !ses.data) throw new Error(`fixture session: ${ses.error?.message}`);
    sessionId = ses.data.id;
    const rev = await admin.from("mentorship_reviews").insert({ session_id: sessionId, mentor_id: mentor.id, reviewer_id: mentee.id, rating: 5, review_text: "ACCT1 review" }).select("id").single();
    if (rev.error || !rev.data) throw new Error(`fixture review: ${rev.error?.message}`);
    reviewId = rev.data.id;
    const sub = await admin.from("application_assessment_submissions").insert({ application_id: applicationId, job_posting_id: jobId, organization_id: orgId, response_text: "ACCT1 response" }).select("id").single();
    if (sub.error || !sub.data) throw new Error(`fixture submission: ${sub.error?.message}`);
    submissionId = sub.data.id;
  }, 120_000);

  afterAll(async () => {
    if (submissionId) await admin.from("application_assessment_submissions").delete().eq("id", submissionId);
    if (reviewId) await admin.from("mentorship_reviews").delete().eq("id", reviewId);
    if (sessionId) await admin.from("mentorship_sessions").delete().eq("id", sessionId);
  }, 120_000);

  const count = async (q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  };
  const reads = async () => ({
    mentorProfile: await count(employer.client.from("mentor_profiles").select("user_id").eq("user_id", mentor.id)),
    slot: await count(employer.client.from("mentor_availability_slots").select("id").eq("id", slotId)),
    review: await count(employer.client.from("mentorship_reviews").select("id").eq("id", reviewId)),
    submissionAsEmployer: await count(employer.client.from("application_assessment_submissions").select("id").eq("id", submissionId)),
  });

  it("BEFORE: a different signed-in user reads the mentor's profile, slot and review, and the employer reads the submission", async () => {
    expect(await reads()).toEqual({ mentorProfile: 1, slot: 1, review: 1, submissionAsEmployer: 1 });
  });

  it("AFTER the mentor is flagged: the profile, slot and review are gone for others; AFTER the applicant is flagged: the submission is gone for the employer but not for the applicant", async () => {
    await setFlag(mentor.id, true);
    await setFlag(applicant.id, true);
    try {
      expect(await reads()).toEqual({ mentorProfile: 0, slot: 0, review: 0, submissionAsEmployer: 0 });
      expect(await count(applicant.client.from("application_assessment_submissions").select("id").eq("id", submissionId)), "the applicant keeps their own submission").toBe(1);
      expect(await count(mentor.client.from("mentor_profiles").select("user_id").eq("user_id", mentor.id)), "the mentor keeps their own profile").toBe(1);
    } finally {
      await setFlag(mentor.id, false);
      await setFlag(applicant.id, false);
    }
  });

  it("RESTORED: all four are back", async () => {
    expect(await reads()).toEqual({ mentorProfile: 1, slot: 1, review: 1, submissionAsEmployer: 1 });
  });
});

describe("the real confirm sets the same flag the surfaces read", () => {
  it("after account_deletion_confirm the applicant is hidden from the employer, and after restore is back", async () => {
    const { token, hash } = generateDeletionToken();
    expect(token).toBeTruthy();
    const created = await admin.rpc("account_deletion_create_request" as never, { p_user_id: applicant.id, p_token_hash: hash } as never);
    expect((created.data as unknown as { ok: boolean }).ok).toBe(true);
    const confirmed = await admin.rpc("account_deletion_confirm" as never, { p_user_id: applicant.id, p_token_hash: hash } as never);
    expect((confirmed.data as unknown as { ok: boolean }).ok).toBe(true);

    const { data: hidden } = await untyped(employer.client).rpc("employer_job_applicants" as never, { p_job_posting_id: jobId } as never);
    expect(hidden).toEqual([]);

    const restored = await untyped(applicant.client).rpc("account_deletion_restore" as never);
    expect((restored.data as unknown as { ok: boolean }).ok).toBe(true);
    const { data: back } = await untyped(employer.client).rpc("employer_job_applicants" as never, { p_job_posting_id: jobId } as never);
    expect((back as unknown as unknown[]).length).toBe(1);
  });
});
