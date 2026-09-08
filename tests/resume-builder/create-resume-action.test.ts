/**
 * createResumeAction's three (really four) start states — Stage 3.1's core
 * mechanism: "blank" (unchanged baseline), "example" (a persona from
 * `EXAMPLE_PERSONAS`, resolved by the chosen template's own `slug` — see
 * persona-for-slug.ts), "import_base" (copy the user's existing is_base=true
 * resume) and "import_upload" (a freshly-parsed file, handed in via a form
 * field).
 *
 * REWORKED FOR THE MULTI-PERSONA REGISTRY, then reworked again for batch 1
 * of the per-slug rollout, then again for batch 2, then again for batch 3A.
 * Before any of these passes, `createResumeAction` always seeded the single
 * `PREVIEW_SAMPLE_RESUME` for "example", so any free template picked with
 * `.limit(1)` gave a deterministic answer. That is no longer true — which
 * persona comes back now depends on the exact slug of the picked template —
 * so:
 *   - a "persona-matching" describe block below is the sabotage-proof
 *     target for the slug -> persona resolution itself: `blueprint` seeds
 *     the (unchanged) EPC engineer persona, `site-plan` and `rig-report`
 *     each seed their OWN new batch-1 persona (not each other's, and not
 *     the EPC engineer's — proving the split is real, not still
 *     category-wide), a free NGO & Development-category template
 *     (`field-mission`) seeds the (still shared, unchanged) development
 *     programme officer persona, `product-tech` (batch 2) seeds its own
 *     new software-engineer persona, `clean-professional` (batch 3A) seeds
 *     its own new generalist persona, and `terminal` (batch 3A) seeds its
 *     own new DevOps-engineer persona;
 *   - a still-unmapped-slug fallback still needs proving, but
 *     `clean-professional` and `terminal` can no longer be that proof: both
 *     were the "no dedicated persona" examples through batch 2 (a Business
 *     slug and a Technology slug respectively — see git history for that
 *     wording), and BATCH 3A GAVE BOTH THEIR OWN PERSONA. As of this batch
 *     every free-tier slug has a dedicated persona, so the two
 *     "falls back rather than crashing" proofs below now use two different,
 *     still-unmapped PREMIUM slugs from two different categories instead
 *     (`rounds` — Healthcare, `statute` — Legal), unlocked the same way
 *     `site-plan`/`rig-report`/`product-tech` already are.
 *
 *     `site-plan`, `rig-report` and `product-tech` moved from free to
 *     premium in the resume-template free-tier cut (migration 0110) — this
 *     suite now explicitly unlocks all three (plus `rounds`/`statute` above)
 *     for the fixture user in `beforeAll` (`templateIdBySlug`, below) rather
 *     than relying on them being free, since these tests are about persona
 *     resolution, not premium gating (that gate has its own dedicated
 *     describe block, "premium template gating is not weakened by any start
 *     state", which picks a premium template dynamically and is unaffected
 *     by which specific slugs are premium).
 *
 * `createResumeAction`'s own `resume_templates` select changed in the
 * multi-persona-registry pass too — it now selects `slug` (used to resolve
 * the persona) instead of `industry_category` (no longer used for that
 * purpose anywhere in the function). Every assertion below that reads back
 * `structured_content` implicitly covers that change: if the select stopped
 * returning `slug`, every "example" test here would seed
 * `PREVIEW_SAMPLE_RESUME` regardless of template and fail immediately.
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
import {
  PREVIEW_SAMPLE_RESUME,
  EPC_SITE_ENGINEER_RESUME,
  DEVELOPMENT_PROGRAMME_OFFICER_RESUME,
  LAND_SURVEYOR_RESUME,
  DRILLING_RIG_SUPERVISOR_RESUME,
  SOFTWARE_ENGINEER_RESUME,
  BUSINESS_GENERALIST_RESUME,
  DEVOPS_ENGINEER_RESUME,
} from "@/lib/resume-builder/preview-sample";

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
// Category-specific free template ids for the persona-matching tests below —
// each fetched by exact slug (not `.limit(1)`) so which category each test
// exercises is explicit and doesn't depend on catalog ordering.
let businessTemplateId: string;
let engineeringTemplateId: string;
let ngoTemplateId: string;
let technologyTemplateId: string;
// Two of the 9 batch-1 new personas, on the Engineering-group slugs
// `site-plan`/`rig-report` — used to prove the per-slug split is real
// within the grouping, not still one persona shared across it. Both moved
// free -> premium in migration 0110 (the resume-template free-tier cut);
// `templateIdBySlug` below unlocks a premium slug for the fixture user
// automatically, so these tests keep exercising persona resolution rather
// than tripping the (separately and dynamically tested) premium gate.
let sitePlanTemplateId: string;
let rigReportTemplateId: string;
// Batch 2: product-tech got its own dedicated persona (SOFTWARE_ENGINEER_
// RESUME). `product-tech` also moved free -> premium in migration 0110;
// same auto-unlock via `templateIdBySlug` applies.
let productTechTemplateId: string;
// BATCH 3A: `businessTemplateId` (clean-professional) and
// `technologyTemplateId` (terminal) both now resolve to their OWN dedicated
// persona — see this file's header. Neither can prove the "unmapped slug
// falls back" behavior anymore, so two different, still-unmapped PREMIUM
// slugs from two different categories cover that instead.
let healthcareNoPersonaTemplateId: string; // "rounds" — Healthcare
let legalNoPersonaTemplateId: string; // "statute" — Legal
const createdResumeIds: string[] = [];

/**
 * Fetches a template's id by slug regardless of its current free/premium
 * status, and — if it is premium — unlocks it for the fixture user so
 * `createResumeAction`'s premium gate never blocks a persona-resolution
 * test that has nothing to do with gating. Free templates are returned
 * as-is with no unlock row written. `deleteTestUsers([userId])` in
 * `afterAll` cascades away any unlock rows this creates, same as it does
 * for the fixture resumes/user, so no dedicated cleanup is needed here.
 */
async function templateIdBySlug(slug: string): Promise<string> {
  const { data, error } = await admin
    .from("resume_templates")
    .select("id, is_premium")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error(`Template "${slug}" not seeded — run \`npm run seed\`.`);
  if (data.is_premium) {
    const { error: unlockErr } = await admin
      .from("user_template_unlocks")
      .upsert({ user_id: userId, template_id: data.id }, { onConflict: "user_id,template_id" });
    if (unlockErr) throw new Error(`Could not unlock template "${slug}" for the fixture user: ${unlockErr.message}`);
  }
  return data.id;
}

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

  // Business, Engineering and NGO & Development (dedicated personas),
  // Technology/`terminal` (also a dedicated persona as of batch 3A — see
  // this file's header for why this used to be the fallback proof and no
  // longer can be).
  businessTemplateId = await templateIdBySlug("clean-professional");
  engineeringTemplateId = await templateIdBySlug("blueprint");
  ngoTemplateId = await templateIdBySlug("field-mission");
  technologyTemplateId = await templateIdBySlug("terminal");
  sitePlanTemplateId = await templateIdBySlug("site-plan");
  rigReportTemplateId = await templateIdBySlug("rig-report");
  productTechTemplateId = await templateIdBySlug("product-tech");
  // BATCH 3A: two still-unmapped premium slugs, from two different
  // categories, now carry the "falls back rather than crashing" proof that
  // `clean-professional`/`terminal` used to carry.
  healthcareNoPersonaTemplateId = await templateIdBySlug("rounds");
  legalNoPersonaTemplateId = await templateIdBySlug("statute");

  // Picked AFTER the persona-dedicated premium slugs above, and explicitly
  // excluding their ids. This describe block's own `afterEach` deletes
  // `premiumTemplateId`'s unlock row after every test (so the "not weakened
  // by any start state" gating tests stay independent of each other) — an
  // unordered "any premium template" pick can silently land on one of the
  // reserved slugs now that the free-tier cut (migration 0110) moved most
  // of them into the premium pool alongside everything else, wiping out
  // their `beforeAll`-established unlock out from under a persona-resolution
  // test that runs later in the same file. Caught live: CI failed exactly
  // this way on "BATCH 2: product-tech seeds its own new software-engineer
  // persona" once #280 (the free-tier cut) and #281 (the layout retune,
  // which added this reservation pattern for the other two) were both on
  // `main` together — neither PR's own branch could have seen this, since
  // each only had its own change.
  const reservedPremiumIds = new Set([
    sitePlanTemplateId,
    rigReportTemplateId,
    productTechTemplateId,
    healthcareNoPersonaTemplateId,
    legalNoPersonaTemplateId,
  ]);
  const { data: premiumRows, error: premiumErr } = await admin
    .from("resume_templates")
    .select("id")
    .eq("is_premium", true);
  if (premiumErr) throw new Error(`Could not list premium templates: ${premiumErr.message}`);
  const premium = premiumRows?.find((row) => !reservedPremiumIds.has(row.id));
  if (!premium) throw new Error("No premium template seeded that isn't reserved by another fixture — run `npm run seed`.");
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

  it('"example" on a still-unmapped premium template (no dedicated persona) seeds the fallback PREVIEW_SAMPLE_RESUME, not a placeholder', async () => {
    let resumeId = "";
    try {
      // Pinned to `rounds` (Healthcare) explicitly — see this file's header
      // for why `clean-professional` (this test's slug through batch 2)
      // can no longer be the example: batch 3A gave it its own persona.
      await createResumeAction(healthcareNoPersonaTemplateId, "example");
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

/**
 * THE PERSONA-MATCHING SABOTAGE-PROOF TARGET for this PR. Before the
 * multi-persona rework, every "example" seed was `PREVIEW_SAMPLE_RESUME`
 * regardless of template. Before batch 1 (this PR), `createResumeAction`
 * resolved a persona from the chosen template's `industry_category` — a
 * whole category grouping shared one persona. Now it resolves from the
 * template's own `slug` (persona-for-slug.ts). These tests hit the real
 * mechanism end-to-end: a real template row, a real `createResumeAction`
 * call, a real inserted `resumes.structured_content` read back — not the
 * resolver function in isolation (that's covered separately in
 * tests/resume-builder/persona-for-slug.test.ts).
 */
describe("createResumeAction's 'example' start state seeds the persona matching the template's own slug", () => {
  it("blueprint seeds the EPC engineer persona, not the old universal default", async () => {
    let resumeId = "";
    try {
      await createResumeAction(engineeringTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(EPC_SITE_ENGINEER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("site-plan seeds ITS OWN batch-1 persona (the land surveyor), not blueprint's EPC engineer or the fallback — proves the Engineering grouping is really split by slug now", async () => {
    let resumeId = "";
    try {
      await createResumeAction(sitePlanTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(LAND_SURVEYOR_RESUME);
    expect(content).not.toEqual(EPC_SITE_ENGINEER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("rig-report seeds ITS OWN batch-1 persona (the drilling rig supervisor), not site-plan's surveyor, blueprint's EPC engineer, or the fallback", async () => {
    let resumeId = "";
    try {
      await createResumeAction(rigReportTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(DRILLING_RIG_SUPERVISOR_RESUME);
    expect(content).not.toEqual(LAND_SURVEYOR_RESUME);
    expect(content).not.toEqual(EPC_SITE_ENGINEER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("an NGO & Development-category template seeds the (still shared, unchanged) development programme officer persona", async () => {
    let resumeId = "";
    try {
      await createResumeAction(ngoTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(DEVELOPMENT_PROGRAMME_OFFICER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("a category with no dedicated persona still seeds something sane (the fallback), not a crash — proven on TWO different categories (Healthcare, Legal)", async () => {
    for (const templateId of [healthcareNoPersonaTemplateId, legalNoPersonaTemplateId]) {
      let resumeId = "";
      try {
        await createResumeAction(templateId, "example");
        throw new Error("expected a redirect");
      } catch (err) {
        resumeId = redirectedResumeId(err);
      }
      createdResumeIds.push(resumeId);
      const content = await createdContent(resumeId);
      expect(content).toEqual(PREVIEW_SAMPLE_RESUME);
    }
  });

  it("BATCH 2: product-tech seeds its own new software-engineer persona, not the fallback and not another slug's persona from the same Technology category", async () => {
    let resumeId = "";
    try {
      await createResumeAction(productTechTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(SOFTWARE_ENGINEER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("BATCH 3A: clean-professional seeds its own new generalist persona, not the fallback it used to share an outcome with", async () => {
    let resumeId = "";
    try {
      await createResumeAction(businessTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(BUSINESS_GENERALIST_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
  });

  it("BATCH 3A: terminal seeds its own new DevOps-engineer persona, not the fallback and not product-tech's software-engineer persona from the same Technology category", async () => {
    let resumeId = "";
    try {
      await createResumeAction(technologyTemplateId, "example");
      throw new Error("expected a redirect");
    } catch (err) {
      resumeId = redirectedResumeId(err);
    }
    createdResumeIds.push(resumeId);
    const content = await createdContent(resumeId);
    expect(content).toEqual(DEVOPS_ENGINEER_RESUME);
    expect(content).not.toEqual(PREVIEW_SAMPLE_RESUME);
    expect(content).not.toEqual(SOFTWARE_ENGINEER_RESUME);
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
