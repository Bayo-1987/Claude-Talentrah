/**
 * Migration 0261 on a real database: a premium resume template can never cost less than 1 credit to unlock.
 *
 * WHY. unlockTemplateAction claims the unlock row, then calls spendCredits(userId, template.unlock_cost_credits, ...), and spend_credits_atomic (0035) raises 'amount must be positive' for 0 or less. The action
 * gives the claim back on any error, so a premium template at cost 0 can never be unlocked by anyone (nothing is charged; the person just sees a failure). The seeders already refuse such a definition
 * (assertValidTemplateDefinitions, #944); this is the same rule in the table itself, so a hand-written row or a future writer cannot get around it.
 *
 * THE TABLE IS SHARED. public.resume_templates is read whole by other test files running in parallel (tests/resume-builder/template-registry.test.ts checks every slug and that no premium row renders as the default
 * component), so this file must never leave an accepted row, or a changed value, in it, not even for a moment on a database WITH the constraint. So:
 *  - the only rows it inserts are ones the constraint must refuse (a premium row at cost 0 and at -1), so on a correct database no row is created at all;
 *  - everything else is done to EXISTING seeded rows, chosen by query (the first premium row, the first free row at cost 0), never by slug: updates the constraint must refuse, and updates that change nothing
 *    (a premium row set to the cost it already has, a free row set to 0) which it must accept;
 *  - a snapshot of every row (slug, is_premium, unlock_cost_credits) is taken in beforeAll, and afterAll puts back, by slug, any row that differs, then deletes any row with this file's slug prefix. That matters on a
 *    database WITHOUT the constraint (the red run), where the refused statements really succeed. afterEach does the same for the two rows this file edits and for its own inserts, so even on such a database a wrong
 *    value lives for one statement, not for the rest of the file;
 *  - the last test checks that the table was left as it was found (see its comment).
 * If the seeded catalog has no premium row or no free row at cost 0, the file FAILS with a message; it never skips (CI runs `npm run seed:catalog` before the unit tests).
 *
 * WHAT A MUTANT OF THE CHECK DOES HERE. Removing the check is caught. `>= 0`, `> -1` and `>= 11` are caught (the first two by the insert at cost 0, the last by the no-op update of a seeded premium row at cost 10). A `>= 2`
 * mutant would SURVIVE: no case writes a premium cost of exactly 1, because writing a new accepted value to a shared row is what this file no longer does.
 *
 * All rows written here carry the slug prefix below; removals check the error (a rejected delete resolves with an error, it does not throw).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

const CONSTRAINT = "resume_templates_premium_unlock_cost_check";
const PREFIX = `tc0261-${randomUUID().slice(0, 8)}-`;
/** Every run of this file uses a fresh prefix; this is the prefix family, so a row left by an earlier crashed run is also removed. */
const FAMILY = "tc0261-";
let n = 0;
const slug = () => `${PREFIX}${++n}`;

type Snap = { id: string; slug: string; is_premium: boolean; unlock_cost_credits: number };
let snapshot: Snap[] = [];
let premium: Snap;
let free: Snap;

const readAll = async (): Promise<Snap[]> => {
  const { data, error } = await admin.from("resume_templates").select("id, slug, is_premium, unlock_cost_credits").order("slug");
  if (error) throw new Error(`could not read resume_templates: ${error.message}`);
  return data ?? [];
};

const readRow = async (id: string) =>
  (await admin.from("resume_templates").select("is_premium, unlock_cost_credits").eq("id", id).single()).data;

async function removeOwnRows() {
  const { error } = await admin.from("resume_templates").delete().like("slug", `${FAMILY}%`);
  if (error) throw new Error(`could not remove the test templates: ${error.message}`);
}

beforeAll(async () => {
  await removeOwnRows();
  snapshot = await readAll();
  const p = snapshot.find((r) => r.is_premium);
  const f = snapshot.find((r) => !r.is_premium && r.unlock_cost_credits === 0);
  if (!p) throw new Error("This test needs a seeded premium resume template and found none: the catalog is not seeded (CI runs `npm run seed:catalog` before the unit tests).");
  if (!f) throw new Error("This test needs a seeded free resume template at cost 0 and found none: the catalog is not seeded (CI runs `npm run seed:catalog` before the unit tests).");
  premium = p;
  free = f;
}, 60_000);

afterAll(async () => {
  // Put back, by slug, any row whose money columns differ from the snapshot (only possible on a database without the constraint), then remove this file's own rows.
  const problems: string[] = [];
  for (const before of snapshot) {
    const { data: now } = await admin.from("resume_templates").select("is_premium, unlock_cost_credits").eq("slug", before.slug).maybeSingle();
    if (now && (now.is_premium !== before.is_premium || now.unlock_cost_credits !== before.unlock_cost_credits)) {
      const { error } = await admin.from("resume_templates").update({ is_premium: before.is_premium, unlock_cost_credits: before.unlock_cost_credits }).eq("slug", before.slug);
      if (error) problems.push(`could not restore ${before.slug}: ${error.message}`);
    }
  }
  const { error } = await admin.from("resume_templates").delete().like("slug", `${FAMILY}%`);
  if (error) problems.push(`could not remove the test templates: ${error.message}`);
  if (problems.length > 0) throw new Error(problems.join("; "));
}, 60_000);

afterEach(async () => {
  for (const before of [premium, free]) {
    if (!before) continue;
    const now = await readRow(before.id);
    if (now && (now.is_premium !== before.is_premium || now.unlock_cost_credits !== before.unlock_cost_credits)) {
      const { error } = await admin.from("resume_templates").update({ is_premium: before.is_premium, unlock_cost_credits: before.unlock_cost_credits }).eq("id", before.id);
      if (error) throw new Error(`could not restore ${before.slug}: ${error.message}`);
    }
  }
  await removeOwnRows();
}, 60_000);

describe("inserting a template the constraint must refuse", () => {
  it.each([0, -1])("a premium template at cost %i is refused by the check constraint (23514) and no row is created", async (cost) => {
    const { data, error } = await admin
      .from("resume_templates")
      .insert({ name: "TC0261 test", slug: slug(), industry_category: "Business", is_premium: true, unlock_cost_credits: cost })
      .select("id")
      .single();
    expect(data, `a premium template at cost ${cost} was saved`).toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain(CONSTRAINT);
  });
});

describe("updating an existing seeded template", () => {
  it.each([0, -1])("taking a seeded premium template to cost %i is refused and the row is left as it was", async (cost) => {
    const { error } = await admin.from("resume_templates").update({ unlock_cost_credits: cost }).eq("id", premium.id);
    expect(error?.code, `a seeded premium template was updated to cost ${cost}`).toBe("23514");
    expect(error?.message).toContain(CONSTRAINT);
    expect(await readRow(premium.id)).toEqual({ is_premium: true, unlock_cost_credits: premium.unlock_cost_credits });
  });

  it("turning a seeded free template at cost 0 into a premium one is refused (it would unlock for nothing) and the row is left as it was", async () => {
    const { error } = await admin.from("resume_templates").update({ is_premium: true }).eq("id", free.id);
    expect(error?.code, "a free template at cost 0 was made premium").toBe("23514");
    expect(error?.message).toContain(CONSTRAINT);
    expect(await readRow(free.id)).toEqual({ is_premium: false, unlock_cost_credits: 0 });
  });

  it("setting a seeded premium template to the cost it already has is accepted and changes nothing", async () => {
    const { error } = await admin.from("resume_templates").update({ unlock_cost_credits: premium.unlock_cost_credits }).eq("id", premium.id);
    expect(error).toBeNull();
    expect(await readRow(premium.id)).toEqual({ is_premium: true, unlock_cost_credits: premium.unlock_cost_credits });
  });

  it("setting a seeded free template to cost 0 (what it already is) is accepted and changes nothing", async () => {
    const { error } = await admin.from("resume_templates").update({ unlock_cost_credits: 0 }).eq("id", free.id);
    expect(error).toBeNull();
    expect(await readRow(free.id)).toEqual({ is_premium: false, unlock_cost_credits: 0 });
  });
});

describe("the catalog on this database", () => {
  it("holds no premium template below cost 1 (the chain, then the seed, leave none)", async () => {
    const { count, error } = await admin
      .from("resume_templates")
      .select("id", { count: "exact", head: true })
      .eq("is_premium", true)
      .lt("unlock_cost_credits", 1)
      // This file's own rows are excluded: on a database without the constraint the refused inserts above are saved (that is the failure they report), and they must not also fail this one.
      .not("slug", "like", `${FAMILY}%`);
    expect(error).toBeNull();
    expect(count, "a premium template that nobody can unlock exists").toBe(0);
  });
});

/**
 * The regression test for this file's own cleanliness. It must be the LAST test. It does NOT compare the whole table: other test files running in parallel insert and delete their own transient rows in
 * public.resume_templates, so a whole-table comparison would flake. It asserts only (a) that none of this file's rows exist, and (b) that every row seen in beforeAll still exists with the same
 * is_premium and unlock_cost_credits.
 */
describe("cleanliness", () => {
  it("leaves the shared template table as it found it", async () => {
    const { data: own, error: ownError } = await admin.from("resume_templates").select("slug").like("slug", `${FAMILY}%`);
    expect(ownError).toBeNull();
    expect(own ?? [], "this file left a row of its own in the shared template table").toEqual([]);

    const now = new Map((await readAll()).map((r) => [r.slug, r]));
    const changed = snapshot
      .filter((before) => {
        const after = now.get(before.slug);
        return !after || after.is_premium !== before.is_premium || after.unlock_cost_credits !== before.unlock_cost_credits;
      })
      .map((r) => r.slug);
    expect(changed, "a template that existed when this file started is missing or has a different is_premium or unlock_cost_credits").toEqual([]);
  });
});
