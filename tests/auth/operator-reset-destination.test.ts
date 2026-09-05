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

  it("sends everybody else to the job feed, unchanged", async () => {
    operatorRow = null;
    expect(await runReset()).toBe("/jobs");
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

  it("sends a DISABLED operator to the job feed", async () => {
    // The fake honours the filter by answering null, which is what a real
    // `is("disabled_at", null)` would do for a disabled row.
    operatorRow = null;
    expect(await runReset()).toBe("/jobs");
    expect(filters).toContainEqual(["is:disabled_at", null]);
  });
});
