/**
 * send-497 / S15 — the mentor list card said "From ₦20,000 / session" while the mentor's own profile said "No open
 * slots right now". Two queries disagreed: the card read the price off the mentor row and never looked at slots.
 * The card's price line now follows whether there is anything to book.
 */
import { describe, expect, it } from "vitest";
import { loadModule } from "../support/load-module";

interface Mod {
  mentorCardPriceLine?: (m: { basePriceNgn: number | null; openSlotCount: number }) => string;
  countOpenSlotsByMentor?: (rows: Array<{ mentor_id: string }>) => Map<string, number>;
}
const mod = () => loadModule<Mod>("@/lib/mentorship/mentor-card");
const need = <T>(fn: T | undefined, name: string): T => {
  expect(fn, `${name} must be exported from src/lib/mentorship/mentor-card.ts`).toBeTypeOf("function");
  return fn as T;
};

describe("mentorCardPriceLine", () => {
  it("with open slots, shows the price", async () => {
    const { mentorCardPriceLine } = await mod();
    expect(need(mentorCardPriceLine, "mentorCardPriceLine")({ basePriceNgn: 20000, openSlotCount: 3 })).toBe("From ₦20,000 / session");
  });

  it("with open slots and no price, says free / volunteer (unchanged)", async () => {
    const { mentorCardPriceLine } = await mod();
    expect(need(mentorCardPriceLine, "mentorCardPriceLine")({ basePriceNgn: null, openSlotCount: 1 })).toBe("Free / volunteer");
  });

  it("with NO open slots, says so instead of quoting a price (the owner's contradiction)", async () => {
    const { mentorCardPriceLine } = await mod();
    const line = need(mentorCardPriceLine, "mentorCardPriceLine")({ basePriceNgn: 20000, openSlotCount: 0 });
    expect(line).toBe("No open slots right now");
    expect(line).not.toMatch(/₦|From/);
  });

  it("says the same for a free mentor with no slots", async () => {
    const { mentorCardPriceLine } = await mod();
    expect(need(mentorCardPriceLine, "mentorCardPriceLine")({ basePriceNgn: null, openSlotCount: 0 })).toBe("No open slots right now");
  });

  it("uses the same words as the mentor's own profile page", async () => {
    const { mentorCardPriceLine } = await mod();
    const profile = (await import("node:fs")).readFileSync("src/app/(app)/mentorship/[mentorId]/page.tsx", "utf8");
    expect(profile).toContain(need(mentorCardPriceLine, "mentorCardPriceLine")({ basePriceNgn: null, openSlotCount: 0 }));
  });
});

describe("countOpenSlotsByMentor", () => {
  it("counts one per slot row, per mentor", async () => {
    const { countOpenSlotsByMentor } = await mod();
    const m = need(countOpenSlotsByMentor, "countOpenSlotsByMentor")([{ mentor_id: "a" }, { mentor_id: "a" }, { mentor_id: "b" }]);
    expect(m.get("a")).toBe(2);
    expect(m.get("b")).toBe(1);
    expect(m.get("c")).toBeUndefined();
  });
});
