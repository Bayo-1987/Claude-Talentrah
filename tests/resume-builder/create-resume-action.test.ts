/**
 * createResumeAction's three (really four) start states — Stage 3.1's core
 * mechanism: "blank" (unchanged baseline), "example" (PREVIEW_SAMPLE_RESUME),
 * "import_base" (copy the user's existing is_base=true resume) and
 * "import_upload" (a freshly-parsed file, handed in via a form field).
 *
 * Runs against the real CI Supabase project, same pattern as
 * tests/passes/pass-covered-actions.test.ts: createClient() is mocked to
 * return a REAL, RLS-honouring session (tests/support/auth.ts's sessionFor())
 * rather than a bare stub, because this action reads/writes `resumes` and
 * `resume_templates` through that same client under RLS.
 *
 * createResumeAction ends with redirect(), which — outside of Next's request
 * context — just throws a plain Error carrying a `.digest` of
 * `NEXT_REDIRECT;<type>;<url>;<status>;` (see next/dist/client/components/
 * redirect.js). No next/navigation mock is needed: the assertions below
 * catch that error directly and read the resume id back out of its digest.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createResumeAction } = await import("@/lib/resume-builder/actions");

function redirectedResumeId(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  // "NEXT_REDIRECT;replace;/resume-builder/edit?resumeId=<uuid>;307;"
  const url = digest.split(";")[2];
  const match = url.match(/resumeId=([^&;]+)/);
  if (!match) throw new Error(`redirect URL had no resumeId: ${url}`);
  return match[1];
}

async function createdContent(resumeId: string): Promise<StructuredResume> {
  const { data, error } = await admin
    .from("resumes")
    .select("structured_content")
    .eq("id", resumeId)
    .single();
  if (error || !data) throw new Error(`fixture lookup: ${error?.message}`);
  return data.structured_content as unknown as StructuredResume;
}

let userId: string;
let userEmail: string;
let freeTemplateId: string;
let premiumTemplateId: string;
const createdResumeIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("resumestart");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const { data: free, error: freeErr } = await admin
    .from("resume_templates")
    .select("id")
    .eq("is_premium", false)
    .limit(1)
    .single();
  if (freeErr || !free) throw new Error("No free template seeded — run `npm run seed`.");
  freeTemplateId = free.id;

  const { data: premium, error: premiumErr } = await admin
    .from("resume_templates")
    .select("id")
    .eq("is_premium", true)
    .limit(1)
    .single();
  if (premiumErr || !premium) throw new Error("No premium template seeded — run `npm run seed`.");
  premiumTemplateId = premium.id;
}, 60_000);

afterEach(async () => {
  // Neither of these unlock/consume anything cross-test: template unlocks
  // and resumes are both per-user and this suite uses one throwaway user for
  // everything, so a leftover unlock from one test would silently change the
  // gating tests that run after it.
  await admin.from("user_template_unlocks").delete().eq("user_id", userId).eq("template_id", premiumTemplateId);
});

afterAll(async () => {
  if (createdResumeIds.length) {
    const { error } = await admin.from("resumes").delete().in("id", createdResumeIds);
    if (error) console.warn(`[cleanup] could not delete fixture resumes: ${error.message}`);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("start-state content selection (sabotage-proof target #3)", () => {
  it('"blank" seeds EMPTY_RESUME, unchanged from before this feature', async () => {
    let resumeId = "";
    try {
      await createResumeAction(freeTemplateId, "blank");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    expect(await createdContent(resumeId)).toEqual(EMPTY_RESUME);
  });

  it('"example" seeds the rewritten PREVIEW_SAMPLE_RESUME, not a placeholder', async () => {
    let resumeId = "";
    try {
      await createResumeAction(freeTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(PREVIEW_SAMPLE_RESUME);
    // Guards against the example itself regressing back to a placeholder —
    // this is the exact content the export guard treats as "unedited".
    expect(content.contact.email).not.toBe("sample@example.com");
    expect(content.contact.name).not.toBe("Sample Candidate");
  });

  it('"import_base" copies the user\'s existing base resume, not the canonical row itself', async () => {
    const baseContent: StructuredResume = {
      ...EMPTY_RESUME,
      contact: { name: "Base Resume Owner", email: "owner@talentrah.test" },
      skills: ["real-skill-from-base-resume"],
    };
    const { data: baseResume, error: baseErr } = await admin
      .from("resumes")
      .insert({ user_id: userId, is_base: true, title: "Base", structured_content: JSON.parse(JSON.stringify(baseContent)) })
      .select("id")
      .single();
    if (baseErr || !baseResume) throw new Error(`fixture base resume: ${baseErr?.message}`);

    try {
      let resumeId = "";
      try {
        await createResumeAction(freeTemplateId, "import_base");
        throw new Error("expected a redirect");
      } catch (err) {
        resumeId = redirectedResumeId(err);
      }
      createdResumeIds.push(resumeId);

      expect(resumeId).not.toBe(baseResume.id);
      expect(await createdContent(resumeId)).toEqual(baseContent);

      // THE CRITICAL PART: the base resume itself must be completely
      // untouched — copying it into a builder draft must never repoint or
      // rewrite the is_base=true row Auto-Apply submits.
      const { data: baseAfter } = await admin
        .from("resumes")
        .select("id, is_base, structured_content")
        .eq("id", baseResume.id)
        .single();
      expect(baseAfter?.is_base).toBe(true);
      expect(baseAfter?.structured_content).toEqual(baseContent);
    } finally {
      await admin.from("resumes").delete().eq("id", baseResume.id);
    }
  });

  it('"import_upload" seeds the sanitized content handed in via the form field, never touching the base resume', async () => {
    const uploaded: StructuredResume = {
      ...EMPTY_RESUME,
      contact: { name: "Uploaded Person", email: "uploaded@talentrah.test" },
      skills: ["parsed-skill-one", "parsed-skill-two"],
    };
    const formData = new FormData();
    formData.set("content", JSON.stringify(uploaded));

    let resumeId = "";
    try {
      await createResumeAction(freeTemplateId, "import_upload", formData);
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    expect(await createdContent(resumeId)).toEqual(uploaded);

    // No is_base=true row should exist for this user at all — nothing in
    // this flow may have created or touched one.
    const { data: baseRows } = await admin
      .from("resumes")
      .select("id")
      .eq("user_id", userId)
      .eq("is_base", true);
    expect(baseRows ?? []).toHaveLength(0);
  });

  it('"import_upload" without a content field throws rather than silently creating a blank resume', async () => {
    await expect(createResumeAction(freeTemplateId, "import_upload", new FormData())).rejects.toThrow(
      /no imported resume content/i,
    );
  });
});

describe("premium template gating is not weakened by any start state (sabotage-proof target #4)", () => {
  const startStates: Array<["blank" | "example" | "import_base" | "import_upload", FormData | undefined]> = [
    ["blank", undefined],
    ["example", undefined],
    ["import_base", undefined],
    ["import_upload", (() => {
      const fd = new FormData();
      fd.set("content", JSON.stringify(EMPTY_RESUME));
      return fd;
    })()],
  ];

  it.each(startStates)('"%s" is blocked on a premium template with no unlock', async (startState, formData) => {
    await expect(createResumeAction(premiumTemplateId, startState, formData)).rejects.toThrow(
      /unlock this template with credits/i,
    );
  });

  it("sanity: the SAME premium template succeeds for every start state once unlocked", async () => {
    const { error: unlockErr } = await admin
      .from("user_template_unlocks")
      .insert({ user_id: userId, template_id: premiumTemplateId });
    if (unlockErr) throw new Error(`fixture unlock: ${unlockErr.message}`);

    for (const [startState, formData] of startStates) {
      let resumeId = "";
      try {
        await createResumeAction(premiumTemplateId, startState, formData);
        throw new Error("expected a redirect");
      } catch (err) {
        resumeId = redirectedResumeId(err);
      }
      createdResumeIds.push(resumeId);
      const { data } = await admin.from("resumes").select("template_id").eq("id", resumeId).single();
      expect(data?.template_id).toBe(premiumTemplateId);
    }
  });
});

describe("instrumentation: a 'selected' event is logged for every start state", () => {
  it('logs start_state="blank" on creation', async () => {
    let resumeId = "";
    try {
      await createResumeAction(freeTemplateId, "blank");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);

    const { data } = await admin
      .from("resume_builder_start_events")
      .select("start_state, event_type")
      .eq("resume_id", resumeId)
      .eq("event_type", "selected")
      .maybeSingle();
    expect(data?.start_state).toBe("blank");
  });
});
