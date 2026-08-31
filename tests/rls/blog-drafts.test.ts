/**
 * A draft blog post must be unreachable by any public client.
 *
 * ── WHY THIS IS AN RLS TEST AND NOT A ROUTE TEST ──────────────────────────
 *
 * The public route filters `status = 'published'`, and that filter is the
 * SECOND guard. If it were the only one, "drafts are private" would hold
 * exactly as long as every future query remembered to write it — and the
 * admin screens use the service-role client, which bypasses RLS, so the two
 * clients are one careless import apart.
 *
 * 0074's policy is the actual guarantee: `using (status = 'published')`. These
 * tests address the database directly with the anon key, so they prove the
 * guarantee rather than the filter.
 *
 * ── WRITES ARE REVOKED, NOT MERELY UNPOLICIED ─────────────────────────────
 *
 * Supabase grants ALL ON ALL TABLES to anon and authenticated by default, and
 * a row policy restricts rows, never verbs — the lesson 0026-0030 cost this
 * project four findings. So 0074 revokes insert/update/delete outright, and
 * the second block below asserts that rather than assuming it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`blog RLS test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const anon: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const draftSlug = `rls-draft-${randomUUID()}`;
const liveSlug = `rls-live-${randomUUID()}`;
const created: string[] = [];

async function make(slug: string, status: "draft" | "published") {
  const { data, error } = await admin
    .from("blog_posts")
    .insert({
      slug,
      title: `Fixture ${status}`,
      description: "Fixture post owned by tests/rls/blog-drafts.",
      author: "Tests",
      body: "## Fixture\n\nBody text for the fixture post.",
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture insert failed: ${error?.message}`);
  created.push(data.id);
  return data.id;
}

let draftId = "";
beforeAll(async () => {
  draftId = await make(draftSlug, "draft");
  await make(liveSlug, "published");
}, 60_000);

afterAll(async () => {
  if (!created.length) return;
  // A rejected delete RESOLVES with an error rather than throwing. Report it.
  const { error } = await admin.from("blog_posts").delete().in("id", created);
  if (error) throw new Error(`cleanup failed, rows left behind: ${error.message}`);
});

describe("anon cannot read a draft", () => {
  it("does not see it in a listing", async () => {
    const { data } = await anon.from("blog_posts").select("slug");
    const slugs = (data ?? []).map((r) => r.slug);
    expect(slugs, "a draft appeared in an anon listing").not.toContain(draftSlug);
    expect(slugs, "the published fixture should be visible").toContain(liveSlug);
  });

  it("does not see it when asking for it by slug", async () => {
    // The distinction that matters: absent from a list is not the same as
    // unreadable. Someone who knows the slug must still get nothing.
    const { data } = await anon.from("blog_posts").select("*").eq("slug", draftSlug);
    expect(data ?? [], "a draft was readable by slug").toHaveLength(0);
  });

  it("does not see it when asking for it by id", async () => {
    const { data } = await anon.from("blog_posts").select("*").eq("id", draftId);
    expect(data ?? [], "a draft was readable by id").toHaveLength(0);
  });
});

describe("no public client can write this table at all", () => {
  it("refuses an anon insert", async () => {
    const { error } = await anon
      .from("blog_posts")
      .insert({ slug: `evil-${randomUUID()}`, title: "x", description: "x", author: "x", body: "x" });
    expect(error, "anon could insert a blog post").not.toBeNull();
  });

  it("refuses an anon update, including publishing a draft", async () => {
    // The specific escalation worth naming: flipping someone else's draft live.
    const { error } = await anon.from("blog_posts").update({ status: "published" }).eq("id", draftId);
    expect(error, "anon could publish a draft").not.toBeNull();

    const { data } = await admin.from("blog_posts").select("status").eq("id", draftId).single();
    expect(data?.status, "the draft's status changed").toBe("draft");
  });

  it("refuses an anon delete", async () => {
    const { error } = await anon.from("blog_posts").delete().eq("id", draftId);
    expect(error, "anon could delete a blog post").not.toBeNull();

    const { count } = await admin
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("id", draftId);
    expect(count, "the post was deleted").toBe(1);
  });
});

describe("status is constrained", () => {
  it("rejects a status outside draft/published", async () => {
    const { error } = await admin
      .from("blog_posts")
      // `status` is typed as plain text, so this compiles; the CHECK
      // constraint is what must reject it, which is the point of the test.
      .update({ status: "archived" })
      .eq("id", draftId);
    expect(error, "the check constraint did not hold").not.toBeNull();
  });
});
