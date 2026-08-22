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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { upsertBaseResume } from "@/lib/resume/upsert-base-resume";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

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

  const { data: existing } = await admin.auth.admin.listUsers();
  const already = existing.users.find((u) => u.email === TEST_EMAIL);
  if (already) await admin.auth.admin.deleteUser(already.id);

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: "VitestUpsertBaseResume123!",
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
