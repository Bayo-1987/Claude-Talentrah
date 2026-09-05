/**
 * Which database is this run about to touch, and is it allowed to?
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Three sessions work in this repo at once and every local run — tests,
 * scripts, seeds — read `.env.local`. For as long as that file pointed at the
 * one hosted `Talentrah CI` project, those runs shared a database: they created
 * and deleted each other's fixtures, and a suite that asserts on a global count
 * could fail for something another session did a second earlier.
 *
 * The evidence was in the project itself. On 2026-09-05, CI had written to it
 * zero times since Stage 2 gave every job its own ephemeral stack — and it
 * still gained 19 auth users in 24 hours. All of them came from local runs.
 *
 * Two symptoms, one cause, and the second is the reason this module prints:
 *
 *   1. Runs corrupt each other, intermittently and unreproducibly.
 *   2. NOBODY CAN TELL. "It works locally" is unfalsifiable when the sentence
 *      does not say which database "locally" meant. That is precisely how a
 *      shared hosted project went unnoticed as the default for weeks.
 *
 * So: a banner at the start of every run naming the target, and a guard that
 * refuses the targets a local run has no business writing to.
 */

/** The live project. Never a test target without an explicit opt-in. */
export const PRODUCTION_REF = "nytwbbzfpytctjsoczzq";

/**
 * The hosted CI project.
 *
 * It is no longer CI's — Stage 2 (#214) gave every CI job its own ephemeral
 * stack, and `ci.yml` reads no hosted Supabase secret at all. What is left is a
 * shared scratch database that only local runs still point at, which is the
 * sharing this module exists to end. The name is kept because that is what the
 * project is still called in the dashboard.
 */
export const HOSTED_CI_REF = "dozaffzgqkbarxtlclsj";

export type DbKind = "local" | "production" | "hosted-ci" | "unknown" | "unset";

export interface DbTarget {
  kind: DbKind;
  url: string;
  /** One line, safe to print: a host and a name, never a key. */
  label: string;
}

/** Local stacks are addressed by loopback, whatever port the CLI assigned. */
function isLoopback(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url);
}

export function describeDbTarget(url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): DbTarget {
  const trimmed = url.trim();
  if (!trimmed) return { kind: "unset", url: "", label: "NEXT_PUBLIC_SUPABASE_URL is not set" };
  if (isLoopback(trimmed)) {
    return { kind: "local", url: trimmed, label: `local ephemeral stack (${trimmed})` };
  }
  if (trimmed.includes(PRODUCTION_REF)) {
    return { kind: "production", url: trimmed, label: `PRODUCTION (${PRODUCTION_REF})` };
  }
  if (trimmed.includes(HOSTED_CI_REF)) {
    return { kind: "hosted-ci", url: trimmed, label: `the shared hosted project (${HOSTED_CI_REF})` };
  }
  // Deliberately not an error. A fourth project is a legitimate thing to point
  // at deliberately; it is only unknown to this file.
  return { kind: "unknown", url: trimmed, label: `an unrecognised project (${trimmed})` };
}

/**
 * The line every run prints before it does anything.
 *
 * WRITTEN TO THE STREAM, NOT THROUGH `console`. Vitest intercepts console
 * methods and its default reporter drops them for a PASSING file — measured:
 * zero `database:` lines on a green run, one under `--reporter=verbose`. A
 * banner that only appears when something already went wrong is not a banner,
 * and this one exists precisely so a green run can be checked. `process.stderr`
 * is not intercepted, and stderr keeps it out of piped stdout.
 */
export function announceDbTarget(context: string): DbTarget {
  const target = describeDbTarget();
  const mark = target.kind === "local" ? "✓" : target.kind === "unset" ? "?" : "!";
  process.stderr.write(`[${context}] ${mark} database: ${target.label}\n`);
  return target;
}

export interface GuardOptions {
  /** Names the run in the error, e.g. "test suite" or "seed". */
  context: string;
  /** Env var that opts into production, typed out on the command line. */
  productionEscapeHatch: string;
  /** Env var that opts into the shared hosted project. */
  hostedEscapeHatch: string;
}

/**
 * Refuse the targets a local run should not write to.
 *
 * Both refusals are escapable, because both have real uses — reproducing
 * something that only happens on a live project. Neither is escapable by
 * drift: the opt-in has to be typed on the command line, and it names what it
 * is opting into.
 */
export function assertAllowedDbTarget(opts: GuardOptions): DbTarget {
  const target = announceDbTarget(opts.context);

  if (target.kind === "production") {
    if (process.env[opts.productionEscapeHatch] === "yes-i-mean-it") {
      console.warn(
        `\n[${opts.context}] ⚠ RUNNING AGAINST PRODUCTION on purpose ` +
          `(${opts.productionEscapeHatch}). This will create and delete real rows.\n`,
      );
      return target;
    }
    throw new Error(
      [
        "",
        `Refusing to run the ${opts.context} against PRODUCTION.`,
        "",
        `  NEXT_PUBLIC_SUPABASE_URL points at ${PRODUCTION_REF} (the live project).`,
        "",
        "  Fix: start a local stack and point .env.local at it —",
        "    npm run db:local",
        "",
        `  If you genuinely need production: ${opts.productionEscapeHatch}=yes-i-mean-it`,
        "",
      ].join("\n"),
    );
  }

  if (target.kind === "hosted-ci") {
    if (process.env[opts.hostedEscapeHatch] === "yes-i-mean-it") {
      console.warn(
        `\n[${opts.context}] ⚠ RUNNING AGAINST THE SHARED HOSTED PROJECT on purpose ` +
          `(${opts.hostedEscapeHatch}). Other sessions are probably using it too.\n`,
      );
      return target;
    }
    throw new Error(
      [
        "",
        `Refusing to run the ${opts.context} against the shared hosted project.`,
        "",
        `  NEXT_PUBLIC_SUPABASE_URL points at ${HOSTED_CI_REF}.`,
        "",
        "  That project is shared by every session working in this repo, and it is",
        "  no longer CI's — since #214 each CI job starts its own ephemeral stack",
        "  and CI never touches this one. What remained was local runs creating and",
        "  deleting each other's fixtures, which is why a suite could fail for",
        "  something another session did a second earlier.",
        "",
        "  Fix: get your own stack. It takes one command —",
        "    npm run db:local",
        "",
        `  If you genuinely need the hosted project: ${opts.hostedEscapeHatch}=yes-i-mean-it`,
        "",
      ].join("\n"),
    );
  }

  return target;
}
