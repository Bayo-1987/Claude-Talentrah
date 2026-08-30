/**
 * Regression test for QA audit bug #1: re-uploading a resume used to insert
 * a second is_base=true row instead of replacing the first, which silently
 * broke match scoring (falls back to an empty resume with no error) and
 * tailoring (falsely claims no base resume exists) once a user had two.
 *
 * Integration-level on purpose: this project has no local Supabase emulator,
 * and the actual bug lived in the interaction between application code and
 * real Postgres constraints (see migration 0010_one_base_resume_per_user),
 * so a mocked client would not have caught it. Runs against the real
 * "Talentrah" Supabase project using a disposable test user, cleaned up
 * after each run.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { upsertBaseResume } from "@/lib/resume/upsert-base-resume";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { findUserByEmail } from "../support/list-users";

const TEST_EMAIL = "vitest-upsert-base-resume@talentrah.dev";

let admin: SupabaseClient<Database>;
let userId: string;

const RESUME_V1: StructuredResume = {
  ...EMPTY_RESUME,
  contact: { name: "Version One" },
  skills: ["excel"],
};

const RESUME_V2: StructuredResume = {
  ...EMPTY_RESUME,
  contact: { name: "Version Two" },
  skills: ["sql", "python"],
};

beforeAll(async () => {
  admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Paginated: the unpaginated version of this is exactly what broke the
  // seed — miss the account past page one, then createUser reports
  // "already registered" and the test fails for a reason that looks unrelated.
  const already = await findUserByEmail(admin, TEST_EMAIL);
  if (already) await admin.auth.admin.deleteUser(already.id);

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    // Random per run, not a literal: the account is deleted in afterAll, but
    // while a CI run is in flight it is a real account on the live project,
    // and this repo is public.
    password: `vitest-${randomBytes(24).toString("base64url")}`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("Failed to create test user");
  userId = data.user.id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("upsertBaseResume", () => {
  it("replaces the existing base resume instead of creating a second one", async () => {
    await upsertBaseResume(admin, userId, RESUME_V1, "uploaded");
    await upsertBaseResume(admin, userId, RESUME_V2, "uploaded");

    const { data: baseResumes, error } = await admin
      .from("resumes")
      .select("id, structured_content")
      .eq("user_id", userId)
      .eq("is_base", true);

    expect(error).toBeNull();
    expect(baseResumes).toHaveLength(1);

    const content = baseResumes![0].structured_content as unknown as StructuredResume;
    expect(content.contact.name).toBe("Version Two");
    expect(content.skills).toEqual(["sql", "python"]);
  });

  it("a downstream read (what the job feed / tailoring use) sees the latest content, not the first", async () => {
    // Simulates exactly the query src/app/(app)/jobs/page.tsx and
    // src/app/api/tailoring/route.ts run — .maybeSingle() must succeed
    // (not error from multiple rows) and return the second write.
    const { data, error } = await admin
      .from("resumes")
      .select("structured_content")
      .eq("user_id", userId)
      .eq("is_base", true)
      .maybeSingle();

    expect(error).toBeNull();
    const content = data!.structured_content as unknown as StructuredResume;
    expect(content.contact.name).toBe("Version Two");
  });

  it("records how well the upload parsed, and does not erase it on a later save (0070)", async () => {
    /*
     * The parse confidence was computed and thrown away before 0070, which is
     * why #139's empty-skills resume had to be diagnosed from the shape of its
     * stored fields. Two properties matter and only one is obvious:
     *
     *   1. an upload that parsed badly is recorded as `low`
     *   2. a LATER save that knows nothing about parsing — the builder, which
     *      passes no confidence — must not overwrite that with null, or the
     *      signal disappears the first time the user edits their resume
     */
    await upsertBaseResume(admin, userId, RESUME_V1, "uploaded", undefined, "low");

    const afterUpload = await admin
      .from("resumes")
      .select("parse_confidence")
      .eq("user_id", userId)
      .eq("is_base", true)
      .single();
    expect(afterUpload.data?.parse_confidence).toBe("low");

    await upsertBaseResume(admin, userId, RESUME_V2, "builder");

    const afterEdit = await admin
      .from("resumes")
      .select("parse_confidence")
      .eq("user_id", userId)
      .eq("is_base", true)
      .single();
    expect(
      afterEdit.data?.parse_confidence,
      "a builder save erased the record of a degraded parse",
    ).toBe("low");
  });

  it("the database itself rejects a second is_base=true row, even bypassing the helper", async () => {
    // Proves migration 0010's unique partial index is real, not just
    // relying on this one function's application-level logic.
    const { error } = await admin.from("resumes").insert({
      user_id: userId,
      is_base: true,
      title: "Bypass attempt",
      source: "uploaded",
      structured_content: {},
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505"); // unique_violation

    const { data: baseResumes } = await admin
      .from("resumes")
      .select("id")
      .eq("user_id", userId)
      .eq("is_base", true);
    expect(baseResumes).toHaveLength(1);
  });
});
