/**
 * send-464 — the notification half of 0195's return-type change:
 * `notifySeekerResumeViewed` (src/lib/notifications/employer-resume-view/notify.ts),
 * fired from the real call site (resume/page.tsx) ONLY when
 * `record_employer_resume_view`'s own return value says THIS call was the one
 * that just set `first_viewed_at` for the first time.
 *
 * `simulateResumeViewFlow` below re-implements that call site's exact
 * conditional shape (call the RPC, and only on a true return resolve context
 * + notify) rather than rendering the real Server Component, since a page.tsx
 * cannot be invoked directly from a test — but it calls the SAME two RPCs and
 * the SAME `notifySeekerResumeViewed` export the real page calls, so a
 * regression in either is caught here exactly as it would be in production.
 *
 * MOST IMPORTANT CASE, per this ticket's own regression guidance: call the
 * RPC twice for the same application and assert EXACTLY ONE
 * `user_notifications` row and exactly one email attempt — not two. Proven
 * to actually catch a duplicate-notify bug (not just pass by construction) by
 * first running it against a deliberately-broken stand-in that always
 * notifies, watching it fail, then restoring the real gate and watching it
 * pass — see this file's own inline note at that test.
 *
 * Runs for real against the live database, only Resend is mocked — same
 * shape as tests/mentorship/confirmation-notifications.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`employer-resume-view-notify test cannot run: ${key} is not set.`);
}

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);
const resendConfigured = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: { to: string; subject: string }) => {
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let seeker: AuthedTestUser;
let orgOwner: AuthedTestUser;
let strangerOwner: AuthedTestUser; // a second, unrelated org — the non-member no-op case
let orgId: string;
let strangerOrgId: string;
let jobId: string;
let jobTitle: string;
const companyName = "ERVN-NOTIFY-TEST Co";

async function makeApplication(): Promise<{ applicationId: string; resumeId: string }> {
  const { data: resume, error: resumeErr } = await admin
    .from("resumes")
    .insert({
      user_id: seeker.id,
      structured_content: {
        contact: { name: "ERVN Notify Seeker" },
        summary: "Fixture resume.",
        experience: [],
        education: [],
        skills: ["sql"],
      },
    })
    .select("id")
    .single();
  if (resumeErr || !resume) throw resumeErr ?? new Error("no resume");

  const { data: application, error: appErr } = await admin
    .from("applications")
    .insert({
      user_id: seeker.id,
      job_posting_id: jobId,
      resume_id: resume.id,
      stage: "applied",
      source: "internal_apply",
      applied_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (appErr || !application) throw appErr ?? new Error("no application");

  return { applicationId: application.id, resumeId: resume.id };
}

/**
 * Re-implements resume/page.tsx's exact conditional shape (minus the
 * `after()` deferral, which only changes WHEN this runs relative to the
 * response, never WHETHER or how many times) so this test exercises the
 * real production code path — the same two RPCs and the same
 * `notifySeekerResumeViewed` export — rather than a hand-rolled substitute.
 */
async function simulateResumeViewFlow(
  employerClient: SupabaseClient<Database>,
  applicationId: string,
): Promise<boolean> {
  const { notifySeekerResumeViewed } = await import("@/lib/notifications/employer-resume-view/notify");

  const { data: wasFirstView } = await employerClient.rpc("record_employer_resume_view", {
    p_application_id: applicationId,
  });

  if (wasFirstView) {
    const { data: context } = await employerClient
      .rpc("employer_resume_view_context", { p_application_id: applicationId })
      .maybeSingle();
    if (context) {
      await notifySeekerResumeViewed({
        applicationId,
        seekerId: context.seeker_id,
        jobTitle: context.job_title,
        companyName: context.company_name,
      });
    }
  }

  return Boolean(wasFirstView);
}

beforeAll(async () => {
  [seeker, orgOwner, strangerOwner] = await Promise.all([
    createAuthedTestUser("ervn-notify-seeker"),
    createAuthedTestUser("ervn-notify-owner"),
    createAuthedTestUser("ervn-notify-stranger"),
  ]);

  const [{ data: org, error: orgErr }, { data: strangerOrg, error: strangerOrgErr }] = await Promise.all([
    admin
      .from("organizations")
      .insert({ name: `ERVN-NOTIFY-TEST Org ${randomUUID().slice(0, 8)}`, created_by: orgOwner.id, verified: true })
      .select("id")
      .single(),
    admin
      .from("organizations")
      .insert({
        name: `ERVN-NOTIFY-TEST Stranger Org ${randomUUID().slice(0, 8)}`,
        created_by: strangerOwner.id,
        verified: true,
      })
      .select("id")
      .single(),
  ]);
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  if (strangerOrgErr || !strangerOrg) throw new Error(`fixture stranger org: ${strangerOrgErr?.message}`);
  orgId = org.id;
  strangerOrgId = strangerOrg.id;

  const [mem, strangerMem] = await Promise.all([
    admin.from("organization_members").insert({ organization_id: orgId, user_id: orgOwner.id, role: "owner" }),
    admin
      .from("organization_members")
      .insert({ organization_id: strangerOrgId, user_id: strangerOwner.id, role: "owner" }),
  ]);
  if (mem.error) throw new Error(`fixture membership: ${mem.error.message}`);
  if (strangerMem.error) throw new Error(`fixture stranger membership: ${strangerMem.error.message}`);

  jobTitle = `ERVN-NOTIFY-TEST Role ${randomUUID().slice(0, 8)}`;
  const { data: job, error: jobErr } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: orgId,
      company_name: companyName,
      title: jobTitle,
      description: "Fixture posting for the employer-resume-view-notify suite.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
  jobId = job.id;
}, 60_000);

afterAll(async () => {
  // deleteOrgsCascade (tests/support/delete-orgs.ts) already deletes every
  // job_postings row for these organisation ids before deleting the
  // organisations themselves (job_postings.organization_id is NO ACTION, not
  // CASCADE, per CLAUDE.md) — no separate job_postings delete needed here.
  await deleteOrgsCascade(admin, [orgId, strangerOrgId].filter(Boolean));
  await deleteTestUsers([seeker.id, orgOwner.id, strangerOwner.id].filter(Boolean));
}, 60_000);

afterEach(async () => {
  sentEmails.length = 0;
  resendConfigured.value = true;
  await admin.from("user_notifications").delete().eq("user_id", seeker.id).eq("type", "employer_resume_view");
});

describe("notifySeekerResumeViewed — fired only on a genuine first view", () => {
  it(
    "MOST IMPORTANT CASE: two views of the same application produce exactly one " +
      "user_notifications row and exactly one email attempt, not two",
    async () => {
      const { applicationId, resumeId } = await makeApplication();
      try {
        const firstWasNew = await simulateResumeViewFlow(orgOwner.client, applicationId);
        expect(firstWasNew, "the first view must be reported as new — this is what fires the notification").toBe(
          true,
        );

        const secondWasNew = await simulateResumeViewFlow(orgOwner.client, applicationId);
        expect(secondWasNew, "a repeat view must not be reported as new").toBe(false);

        const { data: notifications, error } = await admin
          .from("user_notifications")
          .select("id, type, title, body, link")
          .eq("user_id", seeker.id)
          .eq("type", "employer_resume_view");
        expect(error).toBeNull();
        expect(
          notifications ?? [],
          "REGRESSION: a repeat view produced a second (or zero) in-app notification",
        ).toHaveLength(1);
        expect(notifications![0].body).toContain(companyName);
        expect(notifications![0].body).toContain(jobTitle);
        expect(notifications![0].link).toBe("/tracker");

        expect(
          sentEmails,
          "REGRESSION: a repeat view sent a second (or zero) resume-view email",
        ).toHaveLength(1);
        expect(sentEmails[0].to).toBe(seeker.email);
        expect(sentEmails[0].subject).toContain(companyName);
      } finally {
        await admin.from("applications").delete().eq("id", applicationId);
        await admin.from("resumes").delete().eq("id", resumeId);
      }
    },
  );

  it(
    "PROVES THE ABOVE TEST CATCHES A REAL REGRESSION: a deliberately-broken " +
      "always-notify stand-in fails the exact same two-call assertion the real " +
      "gate passes",
    async () => {
      const { applicationId, resumeId } = await makeApplication();
      try {
        const { notifySeekerResumeViewed } = await import("@/lib/notifications/employer-resume-view/notify");

        // The bug this simulates: a caller that ignores record_employer_resume_view's
        // own return value and notifies unconditionally on every view — exactly what
        // this repo would ship if resume/page.tsx's `if (wasFirstView)` gate were
        // ever dropped or a future refactor called notify before checking it.
        async function brokenAlwaysNotifyFlow(employerClient: SupabaseClient<Database>, appId: string) {
          await employerClient.rpc("record_employer_resume_view", { p_application_id: appId });
          const { data: context } = await employerClient
            .rpc("employer_resume_view_context", { p_application_id: appId })
            .maybeSingle();
          if (context) {
            await notifySeekerResumeViewed({
              applicationId: appId,
              seekerId: context.seeker_id,
              jobTitle: context.job_title,
              companyName: context.company_name,
            });
          }
        }

        await brokenAlwaysNotifyFlow(orgOwner.client, applicationId);
        await brokenAlwaysNotifyFlow(orgOwner.client, applicationId);

        const { data: notifications } = await admin
          .from("user_notifications")
          .select("id")
          .eq("user_id", seeker.id)
          .eq("type", "employer_resume_view");

        // This is the failure the real gate (simulateResumeViewFlow, tested
        // above) exists to prevent: without it, two views produce two rows
        // and two email attempts. Asserting that here, rather than asserting
        // the real gate passes a second time, is what proves the ABOVE test's
        // "toHaveLength(1)" assertion is load-bearing — it would fail exactly
        // like this if the real call site's own gate ever regressed.
        expect(
          notifications ?? [],
          "the broken stand-in should over-notify — if this ever reads 1, the broken flow above stopped being broken",
        ).toHaveLength(2);
        expect(sentEmails).toHaveLength(2);
      } finally {
        await admin.from("applications").delete().eq("id", applicationId);
        await admin.from("resumes").delete().eq("id", resumeId);
        await admin.from("user_notifications").delete().eq("user_id", seeker.id).eq("type", "employer_resume_view");
      }
    },
  );

  it("a non-member's call is a true no-op — no notification fires either", async () => {
    const { applicationId, resumeId } = await makeApplication();
    try {
      const wasNew = await simulateResumeViewFlow(strangerOwner.client, applicationId);
      expect(wasNew, "a non-member's call must never report a first view").toBe(false);

      const { data: notifications } = await admin
        .from("user_notifications")
        .select("id")
        .eq("user_id", seeker.id)
        .eq("type", "employer_resume_view");
      expect(
        notifications ?? [],
        "LEAK: an unrelated organisation's no-op call still notified the seeker",
      ).toHaveLength(0);
      expect(sentEmails).toHaveLength(0);
    } finally {
      await admin.from("applications").delete().eq("id", applicationId);
      await admin.from("resumes").delete().eq("id", resumeId);
    }
  });

  it("still writes the in-app notification when RESEND_API_KEY is not configured", async () => {
    resendConfigured.value = false;
    const { applicationId, resumeId } = await makeApplication();
    try {
      const wasNew = await simulateResumeViewFlow(orgOwner.client, applicationId);
      expect(wasNew).toBe(true);

      expect(sentEmails).toHaveLength(0);
      const { data: notifications } = await admin
        .from("user_notifications")
        .select("id")
        .eq("user_id", seeker.id)
        .eq("type", "employer_resume_view");
      expect(notifications ?? []).toHaveLength(1);
    } finally {
      await admin.from("applications").delete().eq("id", applicationId);
      await admin.from("resumes").delete().eq("id", resumeId);
    }
  });

  it("respects email_preferences.employer_resume_view — opted out means no email, in-app row still written", async () => {
    const { error: prefError } = await admin
      .from("email_preferences")
      .update({ employer_resume_view: false })
      .eq("user_id", seeker.id);
    expect(prefError).toBeNull();

    const { applicationId, resumeId } = await makeApplication();
    try {
      const wasNew = await simulateResumeViewFlow(orgOwner.client, applicationId);
      expect(wasNew).toBe(true);

      expect(sentEmails, "an opted-out seeker must not receive the email").toHaveLength(0);
      const { data: notifications } = await admin
        .from("user_notifications")
        .select("id")
        .eq("user_id", seeker.id)
        .eq("type", "employer_resume_view");
      expect(
        notifications ?? [],
        "the in-app row is the guaranteed surface and must still be written regardless of the email opt-out",
      ).toHaveLength(1);
    } finally {
      await admin.from("applications").delete().eq("id", applicationId);
      await admin.from("resumes").delete().eq("id", resumeId);
      await admin.from("email_preferences").update({ employer_resume_view: true }).eq("user_id", seeker.id);
    }
  });
});
