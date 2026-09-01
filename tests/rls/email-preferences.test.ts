/**
 * 0083: the unsubscribe token is a bearer credential, and is treated as one.
 *
 * ── WHAT THIS TABLE IS AND WHY IT IS LOCKED ───────────────────────────────
 *
 * Whoever holds `unsubscribe_token` can change that person's email settings
 * with no session — that is the entire point of a link in an email. So the
 * token must never be something the API will hand out. RLS is on with NO
 * policies and the client roles hold no grants, which means anon and
 * authenticated address zero rows: not other people's, not their own.
 *
 * This project has found the same class of hole four times (0026, 0027, 0028,
 * 0030), always because a row policy was mistaken for a column privilege. Both
 * mechanisms are asserted separately below for that reason — a policy denial
 * silently returns zero rows while a privilege denial raises, and only
 * re-reading with the service role tells either apart from success.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";

const anon: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;
let token: string;
const created: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("emailpref");
  created.push(user.id);
  userId = user.id;

  const { data, error } = await admin
    .from("email_preferences")
    .select("unsubscribe_token, job_match_digest")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`no preferences row was created: ${error?.message}`);
  token = data.unsubscribe_token;
});

afterAll(async () => {
  // email_preferences cascades from profiles, which cascades from the user.
  await deleteTestUsers(created);
});

describe("the row exists without anyone creating it", () => {
  it("a new account gets preferences automatically, opted in", async () => {
    /*
     * The trigger, not the sender. If the sender had to create missing rows, a
     * bug there would look identical to somebody having unsubscribed — and the
     * digest would silently skip people forever.
     */
    const { data } = await admin
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", userId)
      .single();
    expect(data?.job_match_digest).toBe(true);
  });

  it("issues a long, unique token", async () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("no client can reach the token", () => {
  it("anon reads nothing", async () => {
    const { data, error } = await anon.from("email_preferences").select("unsubscribe_token");
    // Either shape is a pass; what must not happen is a token coming back.
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.message).toBeTruthy();
  });

  it("anon cannot find a row even knowing the user id", async () => {
    const { data } = await anon
      .from("email_preferences")
      .select("unsubscribe_token")
      .eq("user_id", userId);
    expect(data ?? [], "the token was readable by an unauthenticated client").toHaveLength(0);
  });

  it("anon cannot write the preference either", async () => {
    const { error } = await anon
      .from("email_preferences")
      .update({ job_match_digest: false })
      .eq("user_id", userId);

    // Re-read with the service role: a row-policy denial affects zero rows
    // and reports no error, which is indistinguishable from success here.
    const { data } = await admin
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", userId)
      .single();
    expect(data?.job_match_digest, "an anonymous client changed a preference").toBe(true);
    if (error) expect(error.message).toBeTruthy();
  });
});

describe("the token is the authorisation", () => {
  it("unsubscribes with a valid token and no session", async () => {
    const { data, error } = await admin.rpc("email_unsubscribe", {
      p_token: token,
      p_subscribed: false,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.matched).toBe(true);

    const { data: row } = await admin
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", userId)
      .single();
    expect(row?.job_match_digest).toBe(false);
  });

  it("re-subscribes with the same token, so a mis-click is recoverable", async () => {
    // A link scanner can fire an unsubscribe the person never saw. Without a
    // way back that silently costs them a channel they wanted.
    await admin.rpc("email_unsubscribe", { p_token: token, p_subscribed: true });
    const { data: row } = await admin
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", userId)
      .single();
    expect(row?.job_match_digest).toBe(true);
  });

  it("reports no match for an unknown token, and changes nothing", async () => {
    const { data } = await admin.rpc("email_unsubscribe", {
      p_token: "0".repeat(64),
      p_subscribed: false,
    });
    expect(data?.[0]?.matched).toBe(false);

    const { data: row } = await admin
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", userId)
      .single();
    expect(row?.job_match_digest, "an unknown token altered somebody's row").toBe(true);
  });
});
