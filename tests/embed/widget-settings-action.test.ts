/**
 * saveJobWidgetSettingsAction (src/lib/employer/widget-actions.ts): the Company Profile card's switch and "max jobs" choice.
 *
 * Writes the signed-in employer's OWN organisation's row in employer_widgets through the user's session client (so row security, not this code, is what authorises it), validates
 * `max_items` as a whole number from 1 to 20, never takes an organisation id from the form, and purges the embed page only after the write has succeeded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
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

beforeEach(() => {
  h.upsert.mockReset().mockResolvedValue({ error: null });
  h.from.mockReset().mockReturnValue({ upsert: h.upsert });
  h.revalidateEmbed.mockReset();
  h.revalidatePath.mockReset();
});

describe("saveJobWidgetSettingsAction", () => {
  it("switches the widget on for the signed-in employer's organisation and purges its embed page", async () => {
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "8" }));
    expect(result).toEqual({ ok: true });
    expect(h.from).toHaveBeenCalledWith("employer_widgets");
    expect(h.upsert).toHaveBeenCalledWith({ organization_id: ORG, enabled: true, max_items: 8 }, { onConflict: "organization_id" });
    expect(h.revalidateEmbed).toHaveBeenCalledWith(ORG);
    expect(h.revalidatePath).toHaveBeenCalledWith("/employer/profile");
  });

  it("an unchecked switch means off (a checkbox that is not sent is false)", async () => {
    await saveJobWidgetSettingsAction(null, form({ maxItems: "10" }));
    expect(h.upsert.mock.calls[0][0]).toMatchObject({ enabled: false, max_items: 10 });
  });

  it("takes the organisation from the session, never from the form", async () => {
    await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "5", organization_id: "99999999-9999-4999-8999-999999999999", organizationId: "99999999-9999-4999-8999-999999999999" }));
    expect(h.upsert.mock.calls[0][0].organization_id).toBe(ORG);
  });

  it("refuses a max-jobs value outside 1 to 20 or that is not a whole number, without writing", async () => {
    for (const bad of ["0", "21", "-3", "2.5", "abc", "", " ", "1e1"]) {
      const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: bad }));
      expect(result, bad).toEqual({ error: expect.stringContaining("1 and 20") });
    }
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.revalidateEmbed).not.toHaveBeenCalled();
  });

  it("accepts the ends of the range", async () => {
    for (const ok of ["1", "20"]) {
      expect(await saveJobWidgetSettingsAction(null, form({ maxItems: ok }))).toEqual({ ok: true });
    }
  });

  it("reports a write error, and purges nothing", async () => {
    h.upsert.mockResolvedValue({ error: { message: "permission denied" } });
    const result = await saveJobWidgetSettingsAction(null, form({ enabled: "on", maxItems: "10" }));
    expect(result).toEqual({ error: expect.stringContaining("couldn't save") });
    expect(h.revalidateEmbed).not.toHaveBeenCalled();
  });
});
