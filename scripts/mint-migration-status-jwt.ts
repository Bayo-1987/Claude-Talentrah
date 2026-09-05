import jwt from "jsonwebtoken";

/**
 * Mints the JWT `check-migration-drift.ts` authenticates with, to call
 * `public.list_applied_migrations()` (migration 0096).
 *
 * ── WHY THIS HAS TO BE RUN BY HAND, NOT BY AN AGENT ────────────────────────
 *
 * Minting this JWT needs the project's own JWT signing secret (Project
 * Settings → API → JWT Settings on the Supabase dashboard,
 * `nytwbbzfpytctjsoczzq` for production). No MCP tool exposes that secret —
 * deliberately, the same reasoning CLAUDE.md gives for every other
 * production credential in this repo. Run this locally with the secret in
 * your own shell, copy ONLY the printed token — never the secret itself —
 * into the `MIGRATION_STATUS_JWT` repository secret, and let the secret
 * leave your terminal for nowhere else.
 *
 * ── WHY THIS TOKEN CLAIMS role: anon PLUS A SECOND CLAIM, NOT A DEDICATED
 *    ROLE ──────────────────────────────────────────────────────────────────
 *
 * The original design was a genuinely separate Postgres role. Hosted
 * Supabase refuses to grant a project owner's new role to `authenticator`
 * ("reserved role, only superusers can modify it") — custom PostgREST-
 * reachable roles aren't something this platform lets a project provision
 * for itself. `role: anon` is the only role this JWT can actually resolve
 * to; the `purpose` claim below is what `list_applied_migrations` actually
 * checks, rejecting every caller without it — including a plain request
 * bearing only the public anon key — with a 403. See 0096's own migration
 * for the full account of why, and why the practical result still matches
 * what a dedicated role was meant to buy.
 *
 * ── WHAT LEAKING THE RESULT ACTUALLY COSTS ─────────────────────────────────
 *
 * The token this prints can do exactly one thing: call
 * `public.list_applied_migrations()`, which returns a list of migration
 * filenames already committed to this repo's own public git history. Gating
 * it at all was never about protecting that list — it's about not
 * normalising "the caller only had the anon key" as a sufficient answer in a
 * codebase whose main safety property is RLS discipline.
 *
 *   SUPABASE_JWT_SECRET=<paste the secret here, only in your own shell> \
 *     npx tsx scripts/mint-migration-status-jwt.ts
 */

const secret = process.env.SUPABASE_JWT_SECRET;
if (!secret) {
  console.error(
    "Set SUPABASE_JWT_SECRET to the target project's JWT signing secret " +
      "(Project Settings → API → JWT Settings) and re-run. Not read from " +
      ".env.local on purpose — that file is scoped to the CI project, and " +
      "this token should almost always be minted for production.",
  );
  process.exit(1);
}

// ~10 years, not forever: this token's only power is reading an
// already-public list of filenames, so the expiry is a rotation reminder,
// not a real defence — there's no meaningful "sooner" that would change what
// a leak costs.
const token = jwt.sign(
  { role: "anon", purpose: "migration-status-reader" },
  secret,
  { expiresIn: "3650d" },
);

console.log(token);
