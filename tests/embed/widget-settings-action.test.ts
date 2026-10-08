/**
 * saveJobWidgetSettingsAction (src/lib/employer/widget-actions.ts): the Company Profile card's switch and "max jobs" choice.
 *
 * Writes the signed-in employer's OWN organisation's row in employer_widgets through the user's session client (so row security, not this code, is what authorises it), validates
 * `max_items` as a whole number from 1 to 20, never takes an organisation id from the form, and purges the embed page only after the write has succeeded.
 *
 * UPDATE FIRST, THEN INSERT, NEVER AN UPSERT. Migration 0237 grants authenticated UPDATE on (enabled, max_items) only and INSERT on (organization_id, enabled, max_items). An upsert
 * becomes INSERT ... ON CONFLICT DO UPDATE SET organization_id, enabled, max_items, which also updates organization_id, a column the role may not update, so Postgres refuses the whole statement
 * ('permission denied for table employer_widgets'): found by QA running the e2e on a real stack. The mock below has no `upsert` at all, so calling one fails the test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  selectAfterUpdate: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  revalidateEmbed: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/employer/membership", () => ({ requireEmployer: async () => ({ organization: { id: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: h.from }) }));
vi.mock("@/lib/embed/revalidate", () => ({ revalidateEmbed: h.revalidateEmbed }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { saveJobWidgetSettingsAction } from "@/lib/employer/widget-actions";

const ORG = "11111111-1111-4111-8111-111111111111";
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

/** An existing row by default: the update answers with the updated row. Pass [] for "no row yet". */
function rowsAfterUpdate(rows: Array<{ organization_id: string }>, error: { message: string; code?: string } | null = null) {
  h.selectAfterUpdate.mockResolvedValue({ data: error ? null : rows, error });
}

beforeEach(() => {
  h.update.mockReset().mockReturnValue({ eq: h.eq });
  h.eq.mockReset().mockReturnValue({ select: h.selectAfterUpdate });
  h.selectAfterUpdate.mockReset();
  rowsAfterUpdate([{ organization_id: ORG }]);
  h.insert.mockReset().mockResolvedValue({ error: null });
  h.from.mockReset().mockReturnValue({ update: h.update, insert: h.insert });
  h.revalidateEmbed.mockReset();
  h.revalidatePath.mockReset();
});

describe("saveJobWidgetSettingsAction", () => {
  it("an organisation that already has a row: UPDATE enabled and max_items only, never an insert, and purge the embed page", async () => {
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "8" }));
    expect(result).toEqual({ ok: true });
    expect(h.from).toHaveBeenCalledWith("employer_widgets");
    expect(h.update).toHaveBeenCalledWith({ enabled: true, max_items: 8 });
    expect(h.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.revalidateEmbed).toHaveBeenCalledWith(ORG);
    expect(h.revalidatePath).toHaveBeenCalledWith("/employer/profile");
  });

  it("an organisation with no row yet: the update matches nothing, so the row is INSERTed with its id, enabled and max_items", async () => {
    rowsAfterUpdate([]);
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "5" }));
    expect(result).toEqual({ ok: true });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.insert).toHaveBeenCalledWith({ organization_id: ORG, enabled: true, max_items: 5 });
    expect(h.revalidateEmbed).toHaveBeenCalledWith(ORG);
  });

  it("never sends organization_id in the UPDATE (the role has no UPDATE privilege on it, so an upsert is refused as a whole)", async () => {
    await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "8" }));
    expect(Object.keys(h.update.mock.calls[0][0]).sort()).toEqual(["enabled", "max_items"]);
  });

  it("two members saving the first row at once: the insert loses the race (unique violation), so it updates again and succeeds", async () => {
    h.selectAfterUpdate.mockReset().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: [{ organization_id: ORG }], error: null });
    h.insert.mockResolvedValue({ error: { message: "duplicate key value violates unique constraint", code: "23505" } });
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "10" }));
    expect(result).toEqual({ ok: true });
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(h.revalidateEmbed).toHaveBeenCalledWith(ORG);
  });

  it("an unchecked switch means off (a checkbox that is not sent is false)", async () => {
    await saveJobWidgetSettingsAction(null, form({ maxItems: "10" }));
    expect(h.update.mock.calls[0][0]).toEqual({ enabled: false, max_items: 10 });
  });

  it("takes the organisation from the session, never from the form", async () => {
    rowsAfterUpdate([]);
    await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "5", organization_id: "99999999-9999-4999-8999-999999999999", organizationId: "99999999-9999-4999-8999-999999999999" }));
    expect(h.eq).toHaveBeenCalledWith("organization_id", ORG);
    expect(h.insert.mock.calls[0][0].organization_id).toBe(ORG);
  });

  it("refuses a max-jobs value outside 1 to 20 or that is not a whole number, without writing", async () => {
    for (const bad of ["0", "21", "-3", "2.5", "abc", "", " ", "1e1"]) {
      const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: bad }));
      expect(result, bad).toEqual({ error: expect.stringContaining("1 and 20") });
    }
    expect(h.update).not.toHaveBeenCalled();
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.revalidateEmbed).not.toHaveBeenCalled();
  });

  it("accepts the ends of the range", async () => {
    for (const ok of ["1", "20"]) {
      expect(await saveJobWidgetSettingsAction(null, form({ maxItems: ok }))).toEqual({ ok: true });
    }
  });

  it("reports an update error, and purges nothing", async () => {
    rowsAfterUpdate([], { message: "permission denied for table employer_widgets" });
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "10" }));
    expect(result).toEqual({ error: expect.stringContaining("couldn't save") });
    expect(h.insert).not.toHaveBeenCalled();
    expect(h.revalidateEmbed).not.toHaveBeenCalled();
  });

  it("reports an insert error that is not a lost race, and purges nothing", async () => {
    rowsAfterUpdate([]);
    h.insert.mockResolvedValue({ error: { message: "permission denied for table employer_widgets", code: "42501" } });
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "10" }));
    expect(result).toEqual({ error: expect.stringContaining("couldn't save") });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.revalidateEmbed).not.toHaveBeenCalled();
  });
});
