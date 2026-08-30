/**
 * Makes someone an admin, un-makes them, lists who is one, or clears a lost
 * second factor.
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
 *   npm run grant-admin -- --reset-mfa someone@talentrah.com
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

const PRODUCTION_REF = "nytwbbzfpytctjsoczzq";

/** The project a key is actually for, from its own `ref` claim. */
function keyProjectRef(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null; // sb_secret_… style keys carry no claims
  try {
    const pad = (x: string) => x + "=".repeat((-x.length % 4 + 4) % 4);
    return JSON.parse(Buffer.from(pad(parts[1]), "base64url").toString()).ref ?? null;
  } catch {
    return null;
  }
}

/** The ref in the URL, which is what PostgREST actually talks to. */
function urlProjectRef(url: string): string | null {
  return /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url)?.[1] ?? null;
}

/**
 * Say what is about to be written to, BEFORE writing to it.
 *
 * This script is the only recovery path for a lost authenticator — Supabase
 * MFA has no recovery codes here and `unenroll` requires aal2, the level a
 * locked-out operator cannot reach — so it is what somebody reaches for under
 * real pressure. Under pressure is exactly when "which database is this
 * pointing at" stops being asked.
 *
 * And the answer is not obvious. `.env.local` targets CI; there is no
 * production credential on disk by design (see CLAUDE.md). So an operator
 * running `--reset-mfa` locally, believing they are fixing production, clears
 * a factor on a database nobody is locked out of, sees a cheerful success
 * line, and concludes the tool is broken.
 *
 * The URL and the KEY are printed separately because they can disagree — that
 * happened on this project, with `.env.local` pointing at CI while a
 * production service key sat underneath it in `.env`. A mismatch is refused
 * outright rather than resolved by guessing which one was meant.
 */
function describeTarget(): { ref: string; isProduction: boolean } {
  const fromUrl = urlProjectRef(URL!);
  const fromKey = keyProjectRef(SERVICE!);

  console.log(`  target URL : ${URL}`);
  console.log(`  URL project: ${fromUrl ?? "unrecognised"}`);
  console.log(`  key project: ${fromKey ?? "unrecognised (non-JWT key)"}`);

  if (fromUrl && fromKey && fromUrl !== fromKey) {
    /*
     * DIAGNOSTIC, NOT A SAFETY NET, and the difference is worth being honest
     * about. A mismatch cannot write to the wrong database: PostgREST talks to
     * the URL and verifies the key against THAT project, so a foreign key is
     * refused outright rather than silently accepted — measured in this repo
     * already, see tests/support/auth.ts on PGRST301.
     *
     * What a mismatch actually costs is an operator's time and their
     * confidence in the tool: every call fails with "Invalid API key" while
     * the config looks plausible. Refusing early, by name, turns a confusing
     * afternoon into one line. The URL is what decides the target — which is
     * why tests/setup.ts's production guard correctly checks the URL alone.
     */
    console.error(
      `\nREFUSING: the URL points at ${fromUrl} but the service key belongs to ${fromKey}.\n` +
        "  Nothing would reach the wrong project — PostgREST refuses a foreign key — but\n" +
        "  every call would fail with 'Invalid API key' while the config looked fine.",
    );
    process.exit(1);
  }

  const ref = fromUrl ?? fromKey ?? "unknown";
  return { ref, isProduction: ref === PRODUCTION_REF };
}

/**
 * Refuse to write to production from this script, and say what to do instead.
 *
 * Not squeamishness: since `.env` was deleted there is no production
 * credential on disk, so reaching production from here requires someone to put
 * one back — which re-creates the exact hazard that deletion removed. The
 * Supabase MCP connector reaches production without a credential ever landing
 * on disk, which is why it is the documented path for one-off production work.
 */
function refuseProduction(operation: string, email: string): never {
  console.error(
    [
      "",
      `REFUSING to ${operation} on PRODUCTION from this script.`,
      "",
      "  There is no production credential on disk by design (CLAUDE.md), so this",
      "  script targets CI. Making it reach production means restoring a service-role",
      "  key to a file — the hazard that removing .env got rid of.",
      "",
      "  Use the Supabase MCP connector against nytwbbzfpytctjsoczzq instead. For a",
      "  lost authenticator that is two steps, in this order:",
      "",
      "    1. delete every factor for the operator   (auth admin API / dashboard)",
      "    2. update public.admin_users",
      `         set mfa_enrolled_at = null where email = '${email.toLowerCase()}';`,
      "",
      "  BOTH, and step 2 is the one that matters: clearing the factor while leaving",
      "  the column set makes the next login demand a code nobody can produce, which",
      "  is the failure this whole path exists to undo.",
      "",
    ].join("\n"),
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
  // Read-only, so no production refusal — but it still says where it looked.
  // "There are no admins" means nothing without knowing which database.
  describeTarget();
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

/**
 * Clear a lost second factor, so an operator can enrol a new one.
 *
 * THE PEER-RESET PATH, and it exists because Supabase MFA has no recovery
 * codes. An operator who loses their authenticator cannot get back in on their
 * own: `unenroll` requires aal2, which is exactly the assurance level they can
 * no longer reach. That refusal is the mitigation working — an attacker
 * holding a reset password hits the same wall — so the way back has to be
 * out-of-band, and this is it.
 *
 * ACCEPTED, DOCUMENTED RISK: WITH ONE ADMIN THIS IS A LOCKOUT. The rescuer is
 * another person holding the service-role key. Today there are two operators,
 * so one can always clear the other. If that count ever drops to one, an
 * operator who loses their device is locked out of /admin entirely until
 * somebody with database access runs this — and if that person is the same
 * locked-out operator, they still have the service-role key and can, so the
 * true failure case is "sole admin loses both their authenticator and their
 * access to the Supabase project". That is not solved here and deliberately
 * so: recovery codes are a credential store of their own, and building one to
 * cover a case that does not currently exist is how a second thing to leak
 * gets added.
 *
 * BOTH SIDES ARE CLEARED IN ONE OPERATION. Removing the factor without
 * clearing `mfa_enrolled_at` would leave the column claiming a protection the
 * account no longer has, and the next login would demand a code nobody can
 * produce — the one drift direction that locks somebody out (0068).
 */
async function resetMfa(email: string) {
  const target = describeTarget();
  if (target.isProduction) refuseProduction("reset MFA", email);

  const normalized = email.toLowerCase();
  const { data: row, error } = await admin
    .from("admin_users")
    .select("id, email, mfa_enrolled_at")
    .eq("email", normalized)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    console.error(`No admin with that address: ${normalized}`);
    process.exit(1);
  }

  // Remove every verified factor Supabase holds for them. Listed rather than
  // assumed to be one: enrolment can leave unverified factors behind if it was
  // abandoned, and leaving those would block a fresh enrolment.
  const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
    userId: row.id,
  });
  if (listError) throw listError;

  for (const factor of factors?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      userId: row.id,
      id: factor.id,
    });
    if (deleteError) throw deleteError;
  }

  const { error: clearError } = await admin
    .from("admin_users")
    .update({ mfa_enrolled_at: null })
    .eq("id", row.id);
  // A rejected Supabase write RESOLVES with an error (CLAUDE.md). Unchecked,
  // this would report a reset that left the column set — which is the exact
  // state that locks the operator out.
  if (clearError) throw clearError;

  console.log(
    `Cleared ${factors?.factors?.length ?? 0} factor(s) for ${row.email}. ` +
      `They will be asked to set up two-factor again on their next visit to /admin.`,
  );
}

async function revoke(email: string) {
  const target = describeTarget();
  if (target.isProduction) refuseProduction("revoke admin access", email);

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
  const target = describeTarget();
  if (target.isProduction) refuseProduction("grant admin", email);

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

  /*
   * `--production` never acts. It exists so that somebody who KNOWS they mean
   * production gets the connector recipe instead of silently operating on CI —
   * which is the failure this flag is here to prevent, not a capability it
   * unlocks.
   */
  if (args.includes("--production")) {
    const email = args.find((a) => a.includes("@")) ?? "someone@example.com";
    refuseProduction("act", email);
  }

  const resetIndex = args.indexOf("--reset-mfa");
  if (resetIndex !== -1) {
    const email = args[resetIndex + 1];
    if (!email) {
      console.error("Usage: npm run grant-admin -- --reset-mfa someone@example.com");
      process.exit(1);
    }
    return resetMfa(email);
  }

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
        "  npm run grant-admin -- --revoke someone@example.com\n" +
        "  npm run grant-admin -- --reset-mfa someone@example.com\n" +
        "\n" +
        "Every write prints the project it is about to touch first. Production is\n" +
        "refused outright — pass --production to see how to do it via the connector.",
    );
    process.exit(1);
  }
  return grant(email, displayName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
