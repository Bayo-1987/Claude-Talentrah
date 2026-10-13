/** A signed-in person with no organisation cannot use the employer's new-applicant setting: the action redirects them to onboarding (it throws Next's redirect) and writes nothing. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB, type TestUser } from "../../support/auth";

const sessionRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => sessionRef.current }));
const { setNewApplicantNoticeAction } = await import("@/lib/employer/new-applicant-notice-actions");

let seeker: TestUser;

beforeAll(async () => {
  seeker = await createTestUser("notice-seeker");
  sessionRef.current = await sessionFor(seeker.email, seeker.id);
  await admin.from("email_preferences").update({ new_applicant_notice: "instant" }).eq("user_id", seeker.id);
});
afterAll(async () => {
  await deleteTestUsers([seeker?.id].filter(Boolean) as string[]);
});

describe("setNewApplicantNoticeAction without an organisation", () => {
  it("is refused (redirected to onboarding) and the preference is unchanged", async () => {
    await expect(setNewApplicantNoticeAction("off")).rejects.toThrow(/NEXT_REDIRECT|redirect/i);
    const { data } = await admin.from("email_preferences").select("new_applicant_notice").eq("user_id", seeker.id).single();
    expect(data?.new_applicant_notice).toBe("instant");
  });
});
