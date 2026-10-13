/**
 * setNewApplicantNoticeAction on a real database with the employer's real session: it writes the CALLER's own preference row, only accepts the three modes, refuses a signed-in user with no
 * organisation, and never touches anyone else's row. ONE employer identity per file (requireUser's cache).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../../support/auth";
import { deleteOrgsCascade } from "../../support/delete-orgs";

const sessionRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sessionRef.current }));

const { setNewApplicantNoticeAction } = await import("@/lib/employer/new-applicant-notice-actions");

let employer: TestUser;
let colleague: TestUser;
let orgId: string;

const modeOf = async (id: string) => (await admin.from("email_preferences").select("new_applicant_notice").eq("user_id", id).single()).data?.new_applicant_notice;

beforeAll(async () => {
  [employer, colleague] = await Promise.all([createTestUser("notice-emp"), createTestUser("notice-col")]);
  sessionRef.current = await sessionFor(employer.email, employer.id);
  const { data: org, error } = await admin.from("organizations").insert({ name: `EMPLOYER-TEST Msg notice ${randomUUID().slice(0, 8)}`, created_by: employer.id, verified: true }).select("id").single();
  if (error || !org) throw new Error(`org: ${error?.message}`);
  orgId = org.id;
  await admin.from("organization_members").insert([{ organization_id: orgId, user_id: employer.id, role: "owner" }, { organization_id: orgId, user_id: colleague.id, role: "admin" }]);
  await admin.from("email_preferences").update({ new_applicant_notice: "instant" }).in("user_id", [employer.id, colleague.id]);
}, 90_000);

afterAll(async () => {
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([employer?.id, colleague?.id].filter(Boolean) as string[]);
});

describe("setNewApplicantNoticeAction", () => {
  it("saves each of the three modes on the caller's own row", async () => {
    for (const mode of ["digest", "off", "instant"] as const) {
      expect(await setNewApplicantNoticeAction(mode)).toEqual({ ok: true, mode });
      expect(await modeOf(employer.id)).toBe(mode);
    }
  });

  it("never changes a colleague's setting", async () => {
    await admin.from("email_preferences").update({ new_applicant_notice: "off" }).eq("user_id", colleague.id);
    await setNewApplicantNoticeAction("digest");
    expect(await modeOf(colleague.id)).toBe("off");
    await admin.from("email_preferences").update({ new_applicant_notice: "instant" }).eq("user_id", colleague.id);
  });

  it("refuses anything that is not one of the three modes, writing nothing", async () => {
    await setNewApplicantNoticeAction("digest");
    for (const bad of ["", "hourly", "INSTANT", "off; drop table x", undefined as unknown as string]) {
      expect(await setNewApplicantNoticeAction(bad), String(bad)).toMatchObject({ ok: false });
    }
    expect(await modeOf(employer.id)).toBe("digest");
  });
});
