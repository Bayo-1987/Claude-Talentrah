/**
 * Where a completed password reset sends you.
 *
 * An operator who starts recovery because they cannot get into /admin used to
 * finish in the seeker job feed, with no route back to the admin door except
 * typing the URL from memory — on the one flow that runs precisely when
 * somebody is already locked out.
 *
 * The check is on ROLE, not on a `redirectTo` parameter, and these tests pin
 * that: there is no user-controlled value in this path, so the open-redirect
 * question does not arise rather than being answered carefully in the form, the
 * emailed callback and the reset page.
 *
 * SINCE 0112 the non-operator branch routes through `onboardingDestination()`
 * rather than naming `/jobs` itself — the same helper signup, sign-in and the
 * OAuth callback use, so every path that hands back a session asks one
 * question in one place. The operator branch is deliberately untouched: an
 * admin session is separate from the Supabase one, and /onboarding is a seeker
 * screen. The tests below therefore assert /onboarding where they once
 * asserted /jobs, and that is the same assertion — "not the admin door" —
 * against a destination that moved.
 *
 * WHAT THIS DOES NOT CHANGE, and must not: the REQUEST step is identical for
 * every address, because that is where the caller is anonymous and a
 * difference would be an enumeration oracle (docs/admin-auth.md). By the time
 * this code runs the caller has proved control of the account, so the
 * destination tells them nothing they do not already know.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";

/** Rows the fake `admin_users` table will answer with. */
let operatorRow: { id: string } | null = null;
/** Filters the action applied, so the query itself can be asserted. */
let filters: Array<[string, unknown]> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
      updateUser: async () => ({ error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      filters.push(["from", table]);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters.push([`eq:${col}`, val]);
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        filters.push([`is:${col}`, val]);
        return chain;
      };
      chain.maybeSingle = async () => ({ data: operatorRow, error: null });
      return chain;
    },
  }),
}));

/** `redirect()` throws; the destination is in the digest. */
function destinationOf(err: unknown): string {
  const digest = (err as { digest?: string })?.digest ?? "";
  const parts = digest.split(";");
  if (parts[0] !== "NEXT_REDIRECT") throw err;
  return parts[2] ?? "";
}

async function runReset(): Promise<string> {
  const { updatePasswordAction } = await import("@/lib/auth/actions");
  const form = new FormData();
  // Meets every rule in getPasswordRequirements: length, upper, lower, number.
  form.set("password", "NewPassword1");
  let returned: unknown;
  try {
    returned = await updatePasswordAction({ error: null }, form);
  } catch (err) {
    return destinationOf(err);
  }
  throw new Error(`the action returned instead of redirecting: ${JSON.stringify(returned)}`);
}

beforeEach(() => {
  operatorRow = null;
  filters = [];
});

describe("a completed password reset", () => {
  it("sends an operator to the admin door, not the job feed", async () => {
    operatorRow = { id: USER_ID };
    expect(await runReset()).toBe("/admin/login");
  });

  it("sends everybody else through the shared onboarding gate", async () => {
    /*
     * WAS `/jobs`, AND THAT ASSERTION WAS A CONTROL, not a product commitment.
     * It existed to prove the operator fix left everyone else where they were
     * — which it did. What changed underneath it is where "everyone else"
     * belongs: completing a reset hands back a live session, so this is a
     * post-authentication destination like sign-in's, and it now asks the same
     * question sign-in asks.
     *
     * This is NOT "resume-less users go to onboarding" — this action does not
     * know or care. It hands off to `/onboarding`, which bounces anyone with a
     * base resume or a skip marker straight to `/jobs`, exactly as before. The
     * single place that decision lives is the whole point.
     */
    operatorRow = null;
    expect(await runReset()).toBe("/onboarding");
  });

  it("asks about THIS user, and only about an operator who is not disabled", async () => {
    operatorRow = { id: USER_ID };
    await runReset();

    // A lookup on the wrong column, or one that forgot `disabled_at`, would
    // still make the two tests above pass — the fake answers whatever it is
    // told. This is the assertion that the query means what it claims.
    expect(filters).toContainEqual(["from", "admin_users"]);
    expect(filters).toContainEqual(["eq:id", USER_ID]);
    expect(filters).toContainEqual(["is:disabled_at", null]);
  });

  it("sends a DISABLED operator down the seeker path, not the admin door", async () => {
    // The fake honours the filter by answering null, which is what a real
    // `is("disabled_at", null)` would do for a disabled row. The assertion
    // that matters is unchanged and unchanged in meaning: a disabled operator
    // does NOT reach /admin/login. Where they go instead is now whatever every
    // other non-operator gets, which is the shared gate.
    operatorRow = null;
    expect(await runReset()).toBe("/onboarding");
    expect(filters).toContainEqual(["is:disabled_at", null]);
  });
});
