/**
 * The Company Profile card's save action against the REAL table and the REAL column grants of migration 0237, through a real RLS-honouring session client (no mocks of the database).
 *
 * This is the test that catches what the unit test with a mocked client cannot: the first version of the action used an upsert, which Postgres refuses outright for `authenticated`
 * because 0237 grants UPDATE on (enabled, max_items) only, not on organization_id ("permission denied for table employer_widgets"). QA found it running the e2e on a real stack.
 * Pinned: no row yet (INSERT), an existing row (UPDATE), a second save changing both fields, a non-member cannot touch another organisation's row, and the stored values are what was saved.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const ref = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ref.current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/embed/revalidate", () => ({ revalidateEmbed: vi.fn() }));

const { saveJobWidgetSettingsAction } = await import("@/lib/employer/widget-actions");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const rowOf = async (orgId: string) => {
  const { data, error } = await (admin as unknown as { from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: { enabled: boolean; max_items: number } | null; error: { message: string } | null }> } } } })
    .from("employer_widgets")
    .select("enabled, max_items")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`row read: ${error.message}`);
  return data;
};

let ownerId: string;
let strangerId: string;
let orgId: string;
let otherOrgId: string;
let strangerClient: DB;

beforeAll(async () => {
  const owner = await createTestUser("widgetsetowner");
  const stranger = await createTestUser("widgetsetstranger");
  ownerId = owner.id;
  strangerId = stranger.id;
  ref.current = await sessionFor(owner.email, owner.id);
  strangerClient = await sessionFor(stranger.email, stranger.id);
  const mkOrg = async (client: DB, userId: string) => {
    const { data, error } = await client.from("organizations").insert({ name: `WIDGETSET-TEST-${randomUUID()}`, domain: `${randomUUID()}.test`, created_by: userId }).select("id").single();
    if (error || !data) throw new Error(`org: ${error?.message}`);
    const { error: m } = await client.from("organization_members").insert({ organization_id: data.id, user_id: userId, role: "owner" });
    if (m) throw new Error(`membership: ${m.message}`);
    return data.id;
  };
  orgId = await mkOrg(ref.current, ownerId);
  otherOrgId = await mkOrg(strangerClient, strangerId);
}, 90_000);

afterAll(async () => {
  for (const id of [orgId, otherOrgId].filter(Boolean)) await admin.from("organization_members").delete().eq("organization_id", id);
  await deleteTestOrgs([orgId, otherOrgId].filter(Boolean));
  await deleteTestUsers([ownerId, strangerId].filter(Boolean));
}, 90_000);

describe("saveJobWidgetSettingsAction on the real table", () => {
  it("the first save for an organisation (no row yet) creates the row", async () => {
    expect(await rowOf(orgId)).toBeNull();
    expect(await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "7" }))).toEqual({ ok: true });
    expect(await rowOf(orgId)).toEqual({ enabled: true, max_items: 7 });
  });

  it("a later save (the row exists) changes both fields in place", async () => {
    expect(await saveJobWidgetSettingsAction(null, form({ maxItems: "12" }))).toEqual({ ok: true });
    expect(await rowOf(orgId)).toEqual({ enabled: false, max_items: 12 });
    expect(await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "3" }))).toEqual({ ok: true });
    expect(await rowOf(orgId)).toEqual({ enabled: true, max_items: 3 });
  });

  it("the stored cap is enforced by the table as well: 21 is refused even if the action were bypassed", async () => {
    const { error } = await (strangerClient as unknown as { from(t: string): { insert(r: object): PromiseLike<{ error: { code?: string } | null }> } })
      .from("employer_widgets")
      .insert({ organization_id: otherOrgId, enabled: true, max_items: 21 });
    expect(error?.code).toBe("23514");
  });

  it("a signed-in non-member cannot write another organisation's row", async () => {
    const { data, error } = await (strangerClient as unknown as { from(t: string): { update(v: object): { eq(c: string, v: string): { select(c: string): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }> } } } })
      .from("employer_widgets")
      .update({ enabled: false, max_items: 1 })
      .eq("organization_id", orgId)
      .select("organization_id");
    expect(error ?? null).toBeNull();
    expect(data).toEqual([]);
    expect(await rowOf(orgId)).toEqual({ enabled: true, max_items: 3 });
  });
});
