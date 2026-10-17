/**
 * Migration 0261 on a real database: a premium resume template can never cost less than 1 credit to unlock.
 *
 * WHY. unlockTemplateAction claims the unlock row, then calls spendCredits(userId, template.unlock_cost_credits, ...), and spend_credits_atomic (0035) raises 'amount must be positive' for 0 or less. The action
 * gives the claim back on any error, so a premium template at cost 0 can never be unlocked by anyone (nothing is charged; the person just sees a failure). The seeders already refuse such a definition
 * (assertValidTemplateDefinitions, #944); this is the same rule in the table itself, so a hand-written row or a future writer cannot get around it.
 *
 * WHAT IS CHECKED. The constraint resume_templates_premium_unlock_cost_check refuses a premium row at cost 0 or -1 (insert) and refuses an update that takes a premium row to cost 0 or turns a free row at cost 0
 * into a premium one; it accepts a free row at cost 0, a premium row at cost 10 and the boundary cost 1; and it does not stand in the way of making a premium row free again. The catalog on this database
 * (built by the whole migration chain, then seeded) holds no premium row below 1.
 *
 * All rows written here carry the slug prefix below and are removed in afterAll with the error checked (a rejected delete resolves with an error, it does not throw).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

const CONSTRAINT = "resume_templates_premium_unlock_cost_check";
const PREFIX = `tc0261-${randomUUID().slice(0, 8)}-`;
let n = 0;
const slug = () => `${PREFIX}${++n}`;

const insert = (over: { is_premium: boolean; unlock_cost_credits: number }) =>
  admin
    .from("resume_templates")
    .insert({ name: "TC0261 test", slug: slug(), industry_category: "Business", ...over })
    .select("id")
    .single();

const read = async (id: string) =>
  (await admin.from("resume_templates").select("is_premium, unlock_cost_credits").eq("id", id).single()).data;

async function cleanup() {
  const { error } = await admin.from("resume_templates").delete().like("slug", `${PREFIX}%`);
  if (error) throw new Error(`could not remove the test templates: ${error.message}`);
}

beforeAll(cleanup, 60_000);
afterAll(cleanup, 60_000);

describe("inserting a template", () => {
  it.each([0, -1])("a premium template at cost %i is refused by the check constraint (23514)", async (cost) => {
    const { data, error } = await insert({ is_premium: true, unlock_cost_credits: cost });
    expect(data, `a premium template at cost ${cost} was saved`).toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain(CONSTRAINT);
  });

  it("a free template at cost 0 is accepted", async () => {
    const { data, error } = await insert({ is_premium: false, unlock_cost_credits: 0 });
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it.each([10, 1])("a premium template at cost %i is accepted", async (cost) => {
    const { data, error } = await insert({ is_premium: true, unlock_cost_credits: cost });
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });
});

describe("updating a template", () => {
  it.each([0, -1])("taking a premium template to cost %i is refused and the row is left as it was", async (cost) => {
    const { data: row } = await insert({ is_premium: true, unlock_cost_credits: 10 });
    const id = row!.id;
    const { error } = await admin.from("resume_templates").update({ unlock_cost_credits: cost }).eq("id", id);
    expect(error?.code, `a premium template was updated to cost ${cost}`).toBe("23514");
    expect(error?.message).toContain(CONSTRAINT);
    expect(await read(id)).toEqual({ is_premium: true, unlock_cost_credits: 10 });
  });

  it("turning a free template at cost 0 into a premium one is refused (it would unlock for nothing)", async () => {
    const { data: row } = await insert({ is_premium: false, unlock_cost_credits: 0 });
    const id = row!.id;
    const { error } = await admin.from("resume_templates").update({ is_premium: true }).eq("id", id);
    expect(error?.code).toBe("23514");
    expect(await read(id)).toEqual({ is_premium: false, unlock_cost_credits: 0 });
  });

  it("making a premium template free again (premium off, cost 0 in one statement) is allowed", async () => {
    const { data: row } = await insert({ is_premium: true, unlock_cost_credits: 10 });
    const id = row!.id;
    const { error } = await admin.from("resume_templates").update({ is_premium: false, unlock_cost_credits: 0 }).eq("id", id);
    expect(error).toBeNull();
    expect(await read(id)).toEqual({ is_premium: false, unlock_cost_credits: 0 });
  });

  it("repricing a premium template to another positive cost is allowed", async () => {
    const { data: row } = await insert({ is_premium: true, unlock_cost_credits: 10 });
    const id = row!.id;
    const { error } = await admin.from("resume_templates").update({ unlock_cost_credits: 5 }).eq("id", id);
    expect(error).toBeNull();
    expect(await read(id)).toEqual({ is_premium: true, unlock_cost_credits: 5 });
  });
});

describe("the catalog on this database", () => {
  it("holds no premium template below cost 1 (the chain, then the seed, leave none)", async () => {
    const { count, error } = await admin
      .from("resume_templates")
      .select("id", { count: "exact", head: true })
      .eq("is_premium", true)
      .lt("unlock_cost_credits", 1)
      // This file's own rows are excluded: on a database without the constraint the refusal tests above save them (that is the failure they report), and they must not also fail this one.
      .not("slug", "like", `${PREFIX}%`);
    expect(error).toBeNull();
    expect(count, "a premium template that nobody can unlock exists").toBe(0);
  });
});
