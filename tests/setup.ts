import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Refuse to run the suite against production.
 *
 * WHY THIS IS A GUARD AND NOT A NOTE IN A README. Every suite here creates real
 * auth users, organisations and job postings, and cleans them up by convention.
 * For most of this project's life the only database was production, so that was
 * the intended behaviour. Since 2026-08-26 CI runs against a separate project
 * (`Talentrah CI`) and production is off-limits — but a local `.env.local` that
 * was never repointed looks and behaves exactly like a correctly configured one
 * until you check what it wrote. It happened twice in a single afternoon,
 * unnoticed both times.
 *
 * This is also the backstop for the more dangerous version: a GitHub secret
 * misconfigured back to production would otherwise run the full suite, seed
 * included, against live data with nothing to stop it.
 *
 * The escape hatch exists because there are real reasons to point a suite at
 * production — reproducing something that only happens there. It has to be
 * typed out on the command line, so it cannot happen by drift.
 */
const PRODUCTION_REF = "nytwbbzfpytctjsoczzq";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (url.includes(PRODUCTION_REF)) {
  if (process.env.ALLOW_TESTS_AGAINST_PRODUCTION === "yes-i-mean-it") {
    console.warn(
      "\n[setup] ⚠ RUNNING AGAINST PRODUCTION on purpose " +
        "(ALLOW_TESTS_AGAINST_PRODUCTION). This will create and delete real rows.\n",
    );
  } else {
    throw new Error(
      [
        "",
        "Refusing to run the test suite against PRODUCTION.",
        "",
        `  NEXT_PUBLIC_SUPABASE_URL points at ${PRODUCTION_REF} (the live project).`,
        "",
        "  These suites create auth users, organisations and job postings. CI runs",
        "  against the separate `Talentrah CI` project; a local run should too.",
        "",
        "  Fix: point .env.local at the CI project —",
        "    NEXT_PUBLIC_SUPABASE_URL=https://dozaffzgqkbarxtlclsj.supabase.co",
        "    NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from that",
        "    project's dashboard (Settings -> API).",
        "",
        "  If you genuinely need production, set:",
        "    ALLOW_TESTS_AGAINST_PRODUCTION=yes-i-mean-it",
        "",
      ].join("\n"),
    );
  }
}
