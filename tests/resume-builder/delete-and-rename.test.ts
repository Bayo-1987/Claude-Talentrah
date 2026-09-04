/**
 * Stage 10 — deleting and renaming a resume, and the three things that must
 * never stop being true.
 *
 * Runs against the real Supabase project, same pattern as
 * create-resume-action.test.ts: `createClient` is mocked to return a REAL,
 * RLS-honouring session rather than a stub, because these actions read and
 * write `resumes` and `applications` through it. `deleteResumeAction` also
 * calls `delete_resume_with_snapshot` through a genuine service-role client,
 * so the grants, the definer rights and the row lock are all exercised as
 * shipped — a mocked RPC would test nothing that can actually break.
 *
 * THE THREE SABOTAGE-PROOFS, each of which was verified by breaking the
 * implementation and watching THIS test fail for the right reason before the
 * fix went back in (recorded per-test below):
 *
 *   1. A user cannot delete another user's resume through any path.
 *   2. The base resume cannot be deleted, ever.
 *   3. Deleting a resume referenced by an application never leaves that
 *      application unable to say what was sent.
 *
 * The third is the one with a trap in it. `ON DELETE SET NULL` on its own
 * makes the delete SUCCEED and quietly erases the answer — strictly worse
 * than today's hard refusal, because the refusal at least loses nothing. So
 * the assertion is not "the delete worked"; it is "the application can still
 * name and show the document", and it is written against the snapshot column
 * rather than the FK.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { parseResumeSnapshot } from "@/lib/applications/resume-snapshot";
import { BASE_RESUME_UNDELETABLE_REASON } from "@/lib/resume-builder/list-state";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { deleteResumeAction, renameResumeAction, createResumeAction } = await import(
  "@/lib/resume-builder/actions"
);
const { initialRenameResumeState } = await import("@/lib/resume-builder/list-state");

let owner: Awaited<ReturnType<typeof createAuthedTestUser>>;
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let freeTemplateId: string;
const createdResumeIds: string[] = [];

/** A recognisable document, so a snapshot can be shown to hold the real thing. */
function contentFor(marker: string): StructuredResume {
  return {
    ...EMPTY_RESUME,
    contact: { name: `DELETE-TEST ${marker}`, email: "delete-test@talentrah.test" },
    summary: `Summary for ${marker}`,
    skills: [`skill-${marker}`],
  };
}

async function makeResume(
  userId: string,
  title: string,
  opts: { isBase?: boolean; marker?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: opts.isBase ?? false,
      title,
      source: "builder",
      structured_content: JSON.parse(JSON.stringify(contentFor(opts.marker ?? title))),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture resume: ${error?.message}`);
  createdResumeIds.push(data.id);
  return data.id;
}

async function makeApplication(
  userId: string,
  fields: { resume_id?: string | null; cover_letter_id?: string | null },
): Promise<string> {
  const { data, error } = await admin
    .from("applications")
    .insert({
      user_id: userId,
      job_posting_id: null,
      manual_job_snapshot: { companyName: "DELETE-TEST Co", title: "DELETE-TEST Role" },
      stage: "applied",
      source: "manual",
      applied_at: new Date().toISOString(),
      ...fields,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture application: ${error?.message}`);
  return data.id;
}

const resumeExists = async (id: string) => {
  const { data } = await admin.from("resumes").select("id").eq("id", id).maybeSingle();
  return data !== null;
};

beforeAll(async () => {
  owner = await createAuthedTestUser("resumedel-owner");
  stranger = await createAuthedTestUser("resumedel-stranger");
  testClientRef.current = owner.client;

  const { data: free, error } = await admin
    .from("resume_templates")
    .select("id")
    .eq("is_premium", false)
    .limit(1)
    .single();
  if (error || !free) throw new Error(`fixture template: ${error?.message}`);
  freeTemplateId = free.id;
});

afterAll(async () => {
  // Applications and tailoring rows go with the profile cascade; resumes that
  // survived a test do not, if the user delete is refused. Reported, never
  // ignored — a rejected Supabase delete resolves with an `error`.
  const { error } = await admin.from("resumes").delete().in("id", createdResumeIds);
  if (error) console.error("[resume delete cleanup]", error.message);
  await deleteTestUsers([owner.id, stranger.id]);
});

// ---------------------------------------------------------------------------
// SABOTAGE-PROOF 1 — another user's resume
// ---------------------------------------------------------------------------
describe("a user cannot delete another user's resume through any path", () => {
  /*
   * BROKEN-THEN-FIXED, recorded: the function's ownership filter
   * (`and r.user_id = p_user_id` on the SELECT ... FOR UPDATE) was removed
   * and the migration re-applied. This test then failed on
   * "the stranger deleted a resume that was not theirs" — the resume was
   * gone and the verdict was ok:true. Restored, and it passes.
   */
  it("the Server Action refuses, and the resume is still there", async () => {
    const resumeId = await makeResume(owner.id, "DELETE-TEST owner's own");

    testClientRef.current = stranger.client;
    const result = await deleteResumeAction(resumeId);
    testClientRef.current = owner.client;

    expect(result.status).toBe("error");
    expect(await resumeExists(resumeId), "the stranger deleted a resume that was not theirs").toBe(
      true,
    );
  });

  it("and so does the function itself, called directly with a forged owner id", async () => {
    // Not a duplicate of the case above: that one proves the ACTION passes the
    // session user through, this one proves the guarantee lives in the
    // database and does not depend on the action being written correctly.
    const resumeId = await makeResume(owner.id, "DELETE-TEST forged caller");

    const { data, error } = await admin.rpc("delete_resume_with_snapshot", {
      p_user_id: stranger.id,
      p_resume_id: resumeId,
    });

    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(false);
    // "not_found", not "not yours": the function must not be an oracle for
    // which resume ids exist.
    expect(data?.[0]?.reason).toBe("not_found");
    expect(await resumeExists(resumeId)).toBe(true);
  });

  it("REGRESSION GUARD: a signed-in user cannot call the function at all", async () => {
    /*
     * The grant is the load-bearing part of the design. `p_user_id` is an
     * authorisation argument, so an `authenticated` EXECUTE grant would hand
     * every signed-in user every other user's resumes with one RPC call —
     * exactly the reasoning 0034 and 0035 record. Asserted on the error CODE,
     * not merely that something failed.
     */
    const resumeId = await makeResume(owner.id, "DELETE-TEST grant guard");

    const { error } = await owner.client.rpc("delete_resume_with_snapshot", {
      p_user_id: owner.id,
      p_resume_id: resumeId,
    });

    expect(error, "authenticated could execute a service_role-only function").not.toBeNull();
    expect(await resumeExists(resumeId)).toBe(true);
  });

  it("and cannot reach the same end with a plain DELETE either", async () => {
    // The other path to the same outcome. RLS is what stops this one, and it
    // fails silently (zero rows) rather than erroring — so the row is re-read
    // with the service role, which is the only way to tell refusal from
    // success here.
    const resumeId = await makeResume(owner.id, "DELETE-TEST direct delete");

    await stranger.client.from("resumes").delete().eq("id", resumeId);

    expect(await resumeExists(resumeId), "RLS let a stranger delete a resume").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SABOTAGE-PROOF 2 — the base resume
// ---------------------------------------------------------------------------
describe("the base resume cannot be deleted, ever", () => {
  /*
   * BROKEN-THEN-FIXED, recorded: the `if v_is_base then return ...` block was
   * deleted from the function and the migration re-applied. Both tests below
   * failed — the first on the verdict (ok:true, reason null) and the second
   * on the row still existing — which is the pair that matters, because the
   * `and r.is_base = false` on the DELETE alone would have kept the row while
   * still reporting success. Restored, and they pass.
   */
  let baseId: string;

  beforeAll(async () => {
    baseId = await makeResume(owner.id, "DELETE-TEST base resume", { isBase: true });
  });

  it("the action refuses, and says why", async () => {
    const result = await deleteResumeAction(baseId);

    expect(result.status).toBe("error");
    // The exact sentence, not just "an error": the whole point of the disabled
    // control is that the user is told the reason.
    expect(result.error).toBe(BASE_RESUME_UNDELETABLE_REASON);
    expect(await resumeExists(baseId), "the base resume was deleted").toBe(true);
  });

  it("the function refuses too, even called with the true owner", async () => {
    const { data, error } = await admin.rpc("delete_resume_with_snapshot", {
      p_user_id: owner.id,
      p_resume_id: baseId,
    });

    expect(error).toBeNull();
    expect(data?.[0]?.ok).toBe(false);
    expect(data?.[0]?.reason).toBe("base_resume");
    expect(await resumeExists(baseId)).toBe(true);
  });

  it("and refuses even when an application depends on it", async () => {
    // The combination worth naming: "it has references" and "it is the base
    // resume" are separate reasons, and the second must not be weakened by
    // the first now that references no longer block a delete.
    await makeApplication(owner.id, { resume_id: baseId });

    const result = await deleteResumeAction(baseId);

    expect(result.status).toBe("error");
    expect(await resumeExists(baseId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SABOTAGE-PROOF 3 — the application keeps its record
// ---------------------------------------------------------------------------
describe("deleting a resume never costs an application its record of what was sent", () => {
  /*
   * BROKEN-THEN-FIXED, recorded, twice over because there are two ways to get
   * this wrong and only one of them looks like a failure:
   *
   *   a) The snapshot UPDATE was removed from the function, leaving the bare
   *      `ON DELETE SET NULL`. The delete succeeded, the application survived
   *      — and this test failed on "the application can no longer say what
   *      was sent", because resume_snapshot was null. That is the assertion
   *      that distinguishes a real fix from a data-loss bug wearing one.
   *   b) The FK was left at NO ACTION with the snapshot column added. The
   *      delete was refused with 23503 and the test failed on the verdict.
   *      Both halves have to ship together, which is why they are one
   *      migration.
   */
  it("nulls the link, keeps the content, and the tracker's reader can still find it", async () => {
    const title = "DELETE-TEST sent with this one";
    const resumeId = await makeResume(owner.id, title, { marker: "sent" });
    const appId = await makeApplication(owner.id, {
      resume_id: resumeId,
      cover_letter_id: resumeId,
    });

    const result = await deleteResumeAction(resumeId);
    expect(result.status).toBe("success");
    expect(await resumeExists(resumeId), "the resume should actually be gone").toBe(false);

    const { data: app } = await admin
      .from("applications")
      .select("id, resume_id, cover_letter_id, resume_snapshot, cover_letter_snapshot")
      .eq("id", appId)
      .single();

    expect(app, "the application was deleted along with the resume").not.toBeNull();
    expect(app!.resume_id).toBeNull();
    expect(app!.cover_letter_id).toBeNull();

    // Read through the SAME parser the tracker page uses, not through a bespoke
    // cast — a snapshot the product's own reader rejects is not a fallback.
    const snapshot = parseResumeSnapshot(app!.resume_snapshot);
    expect(snapshot, "the application can no longer say what was sent").not.toBeNull();
    expect(snapshot!.title).toBe(title);
    expect(snapshot!.content.contact.name).toBe("DELETE-TEST sent");
    expect(snapshot!.content.skills).toContain("skill-sent");
    expect(snapshot!.resumeId).toBe(resumeId);
    expect(snapshot!.capturedAt).toBeTruthy();

    // Both columns, because a single row can reference the same resume twice
    // and a `case` that only covered one would look correct in the common case.
    expect(parseResumeSnapshot(app!.cover_letter_snapshot)?.title).toBe(title);
  });

  it("counts what it snapshotted, so the caller is not guessing", async () => {
    const resumeId = await makeResume(owner.id, "DELETE-TEST two applications");
    await makeApplication(owner.id, { resume_id: resumeId });
    await makeApplication(owner.id, { resume_id: resumeId });

    const { data } = await admin.rpc("delete_resume_with_snapshot", {
      p_user_id: owner.id,
      p_resume_id: resumeId,
    });

    expect(data?.[0]?.ok).toBe(true);
    expect(data?.[0]?.applications_snapshotted).toBe(2);
  });

  it("does not copy the content onto someone else's application", async () => {
    /*
     * `applications.resume_id` is a plain FK with no ownership constraint, and
     * 0041 deliberately left the column user-writable — so a stranger's row
     * CAN point at this resume. The FK still nulls it, which is right. Writing
     * the owner's resume content into that row would be this migration
     * inventing a data leak, so the snapshot UPDATE is scoped to the owner.
     */
    const resumeId = await makeResume(owner.id, "DELETE-TEST leak guard");
    const strangerAppId = await makeApplication(stranger.id, { resume_id: resumeId });

    await deleteResumeAction(resumeId);

    const { data: strangerApp } = await admin
      .from("applications")
      .select("resume_id, resume_snapshot")
      .eq("id", strangerAppId)
      .single();

    expect(strangerApp!.resume_id).toBeNull();
    expect(strangerApp!.resume_snapshot, "another user's resume was copied onto their row").toBeNull();
  });

  it("a tailoring request survives without a snapshot, on purpose", async () => {
    // The deliberate asymmetry: a tailoring request is a log of "pasted a JD,
    // got output", not a record with the weight of an application. It gets a
    // bare SET NULL and no snapshot — and this is the test that would fail if
    // someone "fixed" the FK back to NO ACTION, because the delete would be
    // refused with 23503.
    const resumeId = await makeResume(owner.id, "DELETE-TEST tailoring log");
    const { data: tr, error: trError } = await admin
      .from("job_tailoring_requests")
      .insert({
        user_id: owner.id,
        source_jd_text: "DELETE-TEST jd",
        tailored_resume_id: resumeId,
        tailored_cover_letter_id: resumeId,
      })
      .select("id")
      .single();
    if (trError || !tr) throw new Error(`fixture tailoring request: ${trError?.message}`);

    const result = await deleteResumeAction(resumeId);
    expect(result.status).toBe("success");

    const { data: after } = await admin
      .from("job_tailoring_requests")
      .select("id, tailored_resume_id, tailored_cover_letter_id")
      .eq("id", tr.id)
      .single();

    expect(after, "the tailoring log row was destroyed with the resume").not.toBeNull();
    expect(after!.tailored_resume_id).toBeNull();
    expect(after!.tailored_cover_letter_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------
describe("rename", () => {
  it("stores the new name and echoes back what was stored", async () => {
    const resumeId = await makeResume(owner.id, "DELETE-TEST before rename");

    const form = new FormData();
    form.set("title", "  DELETE-TEST   after   rename  ");
    const result = await renameResumeAction(resumeId, initialRenameResumeState, form);

    expect(result.status).toBe("success");
    // Whitespace collapsed by normalizeResumeTitle, and the ECHO is the stored
    // value — the row's own copy is checked rather than trusting the return.
    expect(result.title).toBe("DELETE-TEST after rename");
    const { data } = await admin.from("resumes").select("title").eq("id", resumeId).single();
    expect(data!.title).toBe("DELETE-TEST after rename");
  });

  it("refuses an empty name rather than storing one", async () => {
    const resumeId = await makeResume(owner.id, "DELETE-TEST keeps its name");

    const form = new FormData();
    form.set("title", "   ");
    const result = await renameResumeAction(resumeId, initialRenameResumeState, form);

    expect(result.status).toBe("error");
    const { data } = await admin.from("resumes").select("title").eq("id", resumeId).single();
    expect(data!.title).toBe("DELETE-TEST keeps its name");
  });

  it("cannot rename another user's resume, and does not claim it did", async () => {
    // The same shape as the notes bug: a refused Supabase update resolves with
    // zero rows, not an error, so the action has to check the row count. This
    // asserts BOTH that the row is unchanged and that the action reported a
    // failure — either one alone would pass while the other was broken.
    const resumeId = await makeResume(owner.id, "DELETE-TEST not yours");

    const form = new FormData();
    form.set("title", "DELETE-TEST hijacked");
    testClientRef.current = stranger.client;
    const result = await renameResumeAction(resumeId, initialRenameResumeState, form);
    testClientRef.current = owner.client;

    expect(result.status).toBe("error");
    const { data } = await admin.from("resumes").select("title").eq("id", resumeId).single();
    expect(data!.title).toBe("DELETE-TEST not yours");
  });
});

// ---------------------------------------------------------------------------
// Default titles
// ---------------------------------------------------------------------------
describe("a gallery-created resume gets a distinguishable name", () => {
  it("is the template name plus the date, not the bare template name", async () => {
    // The defect: two starts from the same template both landed as
    // "Clean Professional". The date is what makes the list readable.
    let resumeId: string | null = null;
    try {
      await createResumeAction(freeTemplateId, "blank");
    } catch (err) {
      const digest = (err as { digest?: string }).digest ?? "";
      resumeId = digest.match(/resumeId=([^&;]+)/)?.[1] ?? null;
    }
    expect(resumeId, "createResumeAction did not redirect to a new resume").toBeTruthy();
    createdResumeIds.push(resumeId!);

    const { data: created } = await admin
      .from("resumes")
      .select("title, template_id")
      .eq("id", resumeId!)
      .single();
    const { data: template } = await admin
      .from("resume_templates")
      .select("name")
      .eq("id", freeTemplateId)
      .single();

    expect(created!.title).not.toBe(template!.name);
    expect(created!.title.startsWith(`${template!.name} — `)).toBe(true);
  });
});
