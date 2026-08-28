/**
 * Makes someone an admin, un-makes them, or lists who is one.
 *
 * THERE IS NO OTHER WAY IN. `admin_users` has RLS on, no policies, and every
 * privilege revoked from `anon` and `authenticated` (0060) — so nothing the
 * app serves, and no signed-in session however privileged, can insert a row
 * here. Admin is granted by someone holding the service-role key and running
 * this, which is the point: there is no self-serve path to promote yourself,
 * and no form to find.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   npm run grant-admin -- someone@talentrah.com "Their Name"
 *   npm run grant-admin -- --list
 *   npm run grant-admin -- --revoke someone@talentrah.com
 *
 * If the address has no Talentrah account yet, this creates the auth user —
 * but only when NEW_ADMIN_PASSWORD is set in the environment:
 *
 *   NEW_ADMIN_PASSWORD='…' npm run grant-admin -- someone@talentrah.com "Name"
 *
 * The password is taken from the environment and never from an argument,
 * because an argument lands in shell history and in the process list, and this
 * repo is public. It is never printed back.
 *
 * ── What --revoke does, and does not ──────────────────────────────────────
 *
 * It sets `disabled_at` and revokes every live session, so the operator is out
 * within one request. It does NOT delete the admin_users row: the audit trail
 * names it, and deleting it would turn every past decision that person made
 * into an anonymous one. Deleting their Talentrah account cascades this row
 * away — that is a separate, deliberate act.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error(
    "grant-admin needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.local).",
  );
  process.exit(1);
}

const admin = createClient<Database>(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Paged, because `listUsers` returns one page and a project with more accounts
 * than the page size would silently "not find" an existing user and try to
 * create it — which then fails on the duplicate and reads as a bug in the
 * script rather than in the lookup.
 */
async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

async function list() {
  const { data, error } = await admin
    .from("admin_users")
    .select("email, display_name, disabled_at, created_at, last_login_at")
    .order("created_at");
  if (error) throw error;
  if (!data?.length) {
    console.log("No admins. Nobody can sign in at /admin/login yet.");
    return;
  }
  for (const row of data) {
    const state = row.disabled_at ? "DISABLED" : "active";
    const seen = row.last_login_at ? `last login ${row.last_login_at}` : "never signed in";
    console.log(`${state.padEnd(8)} ${row.email}  ${row.display_name ?? "—"}  (${seen})`);
  }
}

async function revoke(email: string) {
  const { data, error } = await admin
    .from("admin_users")
    .update({ disabled_at: new Date().toISOString() })
    .eq("email", email.toLowerCase())
    .select("id, email")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    console.error(`No admin with that address: ${email}`);
    process.exit(1);
  }

  // Disabling alone already locks them out — admin_session_validate joins
  // admin_users and refuses a disabled one — but leaving live rows behind
  // makes "who is signed in right now" wrong, and relies on that join staying
  // correct forever. Revoke the sessions too.
  const { error: sessionError } = await admin
    .from("admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("admin_user_id", data.id)
    .is("revoked_at", null);
  // A rejected Supabase write RESOLVES with an error (CLAUDE.md). Unchecked,
  // this would report a revocation that never happened.
  if (sessionError) throw sessionError;

  console.log(`Revoked admin access for ${data.email}. The admin_users row is kept for the audit trail.`);
}

async function grant(email: string, displayName: string | undefined) {
  const normalized = email.toLowerCase();
  let user = await findAuthUserByEmail(normalized);

  if (!user) {
    const password = process.env.NEW_ADMIN_PASSWORD;
    if (!password) {
      console.error(
        `No Talentrah account exists for ${normalized}.\n` +
          "Either have them create one at /signup first, or re-run with a password in the\n" +
          "environment (never as an argument — it would land in shell history):\n\n" +
          "  NEW_ADMIN_PASSWORD='…' npm run grant-admin -- " +
          normalized +
          ' "Their Name"',
      );
      process.exit(1);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
      user_metadata: displayName ? { full_name: displayName } : undefined,
    });
    if (error) throw error;
    user = { id: data.user.id };
    // handle_new_user has just created the matching `profiles` row. That is
    // load-bearing rather than incidental: ad_campaigns.reviewed_by is a
    // foreign key to profiles, so an admin without one could not be recorded
    // as having reviewed anything.
    console.log(`Created a Talentrah account for ${normalized}.`);
  }

  const { error } = await admin.from("admin_users").upsert(
    {
      id: user.id,
      // Stored folded. The unique index is on lower(email) and the failed-login
      // audit lookup matches on equality — see src/lib/admin/actions.ts.
      email: normalized,
      display_name: displayName ?? null,
      // Re-granting someone previously revoked is a normal thing to do and
      // should actually let them back in.
      disabled_at: null,
    },
    { onConflict: "id" },
  );
  if (error) throw error;

  console.log(`${normalized} can now sign in at /admin/login.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) return list();

  const revokeIndex = args.indexOf("--revoke");
  if (revokeIndex !== -1) {
    const email = args[revokeIndex + 1];
    if (!email) {
      console.error("Usage: npm run grant-admin -- --revoke someone@example.com");
      process.exit(1);
    }
    return revoke(email);
  }

  const [email, displayName] = args;
  if (!email || !email.includes("@")) {
    console.error(
      "Usage:\n" +
        "  npm run grant-admin -- someone@example.com \"Their Name\"\n" +
        "  npm run grant-admin -- --list\n" +
        "  npm run grant-admin -- --revoke someone@example.com",
    );
    process.exit(1);
  }
  return grant(email, displayName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
