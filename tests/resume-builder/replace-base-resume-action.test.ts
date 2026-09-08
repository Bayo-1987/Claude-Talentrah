/**
 * replaceBaseResumeAction — the confirm step of the Resume Builder page's
 * "Replace" control on the base-resume row (src/components/resume-builder/
 * replace-base-resume.tsx).
 *
 * THE PROPERTY UNDER TEST, TWICE OVER. This action is the only thing on the
 * Replace surface allowed to call upsertBaseResume, and the parse-only
 * endpoint it sits on top of (/api/resume-builder/import) is shared,
 * unchanged, with the "Import my CV" flow in the New Resume chooser. So two
 * things need proving, with real database reads rather than trusting the
 * route's own doc comment:
 *
 *   1. PARSING ALONE NEVER PERSISTS. Calling /api/resume-builder/import —
 *      the exact call the Replace panel's upload step and the Import
 *      panel's upload step both make — must leave an existing base resume
 *      byte-for-byte untouched, however many times it's called. This is the
 *      real-database version of what import-route-parse-fallback.test.ts
 *      already establishes with a fully mocked Supabase client (that file's
 *      own title says "never writes anywhere", but nothing in it reads the
 *      table back). Doing it here, once, with a real fixture row, covers
 *      the Import flow's half of the split as well as the Replace flow's —
 *      they share the identical route.
 *
 *   2. ONLY AN EXPLICIT CONFIRM PERSISTS, AND IT PERSISTS CORRECTLY.
 *      replaceBaseResumeAction — called only from the "Replace my resume"
 *      button, never from the upload/preview steps — must update the
 *      existing base resume'S row in place: same id, is_base still true,
 *      structured_content now the new (sanitized) content, and still
 *      exactly one is_base=true row for the user afterward. "Exactly one"
 *      is asserted against the database rather than inferred from the
 *      unique partial index alone — same reasoning upsert-base-resume.ts's
 *      own header gives for not trusting a mechanism you haven't queried.
 *
 * Runs against the real CI Supabase project, same pattern as
 * create-resume-action.test.ts: createClient() is mocked to return a REAL,
 * RLS-honouring session (tests/support/auth.ts's sessionFor()) rather than a
 * bare stub, because both the action (via upsertBaseResume) and the route
 * (via supabase.auth.getUser()) go through that same client.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { replaceBaseResumeAction } = await import("@/lib/resume-builder/actions");
const { POST: importPost } = await import("@/app/api/resume-builder/import/route");

function multipartRequest(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("http://localhost/api/resume-builder/import", {
    method: "POST",
    body: formData,
  });
}

async function baseResumeRow(userId: string) {
  const { data, error } = await admin
    .from("resumes")
    .select("id, is_base, structured_content")
    .eq("user_id", userId)
    .eq("is_base", true);
  if (error) throw new Error(`fixture lookup: ${error.message}`);
  return data ?? [];
}

let userId: string;
let userEmail: string;
let baseResumeId: string;
const ORIGINAL_CONTENT: StructuredResume = {
  ...EMPTY_RESUME,
  contact: { name: "Original Base Owner", email: "original@talentrah.test" },
  skills: ["original-skill-one", "original-skill-two"],
};

beforeAll(async () => {
  const user = await createTestUser("replacebase");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  const { data: created, error } = await admin
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: true,
      title: "My resume",
      source: "uploaded",
      structured_content: JSON.parse(JSON.stringify(ORIGINAL_CONTENT)),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`fixture base resume: ${error?.message}`);
  baseResumeId = created.id;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("the parse step alone never persists (Import and Replace share this exact route)", () => {
  it("POST /api/resume-builder/import leaves the existing base resume byte-for-byte unchanged", async () => {
    const text = [
      "Someone Else Entirely",
      "someone-else@example.com",
      "",
      "Skills",
      "a-skill-that-should-never-reach-the-database",
      "",
      "Experience",
      "Role",
      "Company",
      "Did things",
    ].join("\n");
    const file = new File([text], "resume.txt", { type: "text/plain" });

    const response = await importPost(multipartRequest(file));
    expect(response.status).toBe(200);
    const body = await response.json();
    // Sanity: the route did parse something (proves this test would have
    // caught a route that silently no-ops instead of one that silently
    // persists — either bug would otherwise look identical to "unchanged").
    expect(body.resume.contact.email).toBe("someone-else@example.com");

    const rows = await baseResumeRow(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(baseResumeId);
    expect(rows[0].is_base).toBe(true);
    expect(rows[0].structured_content).toEqual(ORIGINAL_CONTENT);
  });

  it("calling it a second time still leaves the base resume untouched — canceling out of the preview step at any point commits nothing", async () => {
    const text = ["Another Person", "another@example.com", "", "Experience", "Role", "Co", "Stuff"].join("\n");
    const file = new File([text], "resume2.txt", { type: "text/plain" });

    await importPost(multipartRequest(file));
    await importPost(multipartRequest(file));

    const rows = await baseResumeRow(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].structured_content).toEqual(ORIGINAL_CONTENT);
  });
});

describe("replaceBaseResumeAction — the only thing on this surface that may persist", () => {
  it("updates the existing base resume in place: same row, is_base still true, content replaced, sanitized", async () => {
    const newContent: StructuredResume = {
      ...EMPTY_RESUME,
      // Leading/trailing whitespace a real upload could plausibly produce —
      // proves the action re-sanitizes rather than trusting content that
      // crossed the client boundary as-is, same as createResumeAction's
      // "import_upload" case.
      contact: { name: "  New Base Owner  ", email: "new-owner@talentrah.test" },
      skills: ["new-skill-one", "new-skill-two", "new-skill-three"],
      experience: [{ title: "Engineer", company: "New Co", bullets: ["Shipped a thing"] }],
    };

    const result = await replaceBaseResumeAction(newContent, "high");
    expect(result.status).toBe("success");

    const rows = await baseResumeRow(userId);
    // THE CRITICAL PART: still exactly one base-resume row for this user,
    // not a second one alongside the original — asserted against the
    // database, not inferred from the unique partial index alone.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(baseResumeId);
    expect(rows[0].is_base).toBe(true);

    const stored = rows[0].structured_content as unknown as StructuredResume;
    expect(stored.contact.name).toBe("New Base Owner");
    expect(stored.contact.email).toBe("new-owner@talentrah.test");
    expect(stored.skills).toEqual(["new-skill-one", "new-skill-two", "new-skill-three"]);
    expect(stored).not.toEqual(ORIGINAL_CONTENT);

    const { data: confidenceRow, error } = await admin
      .from("resumes")
      .select("parse_confidence")
      .eq("id", baseResumeId)
      .single();
    if (error) throw new Error(`fixture lookup: ${error.message}`);
    expect(confidenceRow?.parse_confidence).toBe("high");
  });
});
