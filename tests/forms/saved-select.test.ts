/**
 * SELECT-REMOUNT-2. A <select> reads its defaultValue only when it MOUNTS, so a refused save keeps the typed choice by remounting it (selectKey). But the select's other input is the SAVED value (a prop that changes
 * when a save succeeds and the page revalidates). Keyed by the typed value alone, a refused save followed by a successful one remounts the select with the saved value as it was BEFORE the revalidated row
 * arrived, so it showed the old choice and the next Save wrote it back (COURSE-TIER-1 on the catalog; the same pattern on Settings > Country, Edit scholarship > Funding and the operator role select).
 * savedSelect puts both inputs into the key, so the key changes whenever the default does and the select shows the saved value once it arrives.
 */
import { describe, expect, it } from "vitest";
import { savedSelect } from "@/lib/forms/saved-select";

describe("savedSelect", () => {
  it("nothing typed yet: the saved value is the default", () => {
    expect(savedSelect("country", "Nigeria", undefined)).toEqual({ key: "Nigeria|country:", defaultValue: "Nigeria" });
  });

  it("a refused save keeps the typed choice, and the key follows it", () => {
    const refused = savedSelect("country", "Nigeria", { country: "Kenya" });
    expect(refused.defaultValue).toBe("Kenya");
    expect(refused.key).not.toBe(savedSelect("country", "Nigeria", undefined).key);
  });

  it("refused (typed Kenya) then saved (Kenya), once the revalidated saved value arrives: the select shows Kenya, not the old Nigeria", () => {
    const afterRefusal = savedSelect("country", "Nigeria", { country: "Kenya" });
    const afterSaveBeforePropArrives = savedSelect("country", "Nigeria", undefined); // a success returns no values; the prop is still the old one for an instant
    const afterPropArrives = savedSelect("country", "Kenya", undefined);
    expect(afterSaveBeforePropArrives.key).not.toBe(afterRefusal.key);
    expect(afterPropArrives.defaultValue).toBe("Kenya");
    // The key must CHANGE when the revalidated value lands, or the select would stay on the stale instant (the bug).
    expect(afterPropArrives.key).not.toBe(afterSaveBeforePropArrives.key);
  });

  it("a typed empty choice is still a choice (the placeholder), not a fall back to the saved value", () => {
    expect(savedSelect("country", "Nigeria", { country: "" }).defaultValue).toBe("");
  });

  it("a saved value of null or undefined shows the placeholder", () => {
    expect(savedSelect("country", null, undefined).defaultValue).toBe("");
    expect(savedSelect("country", undefined, undefined)).toEqual({ key: "|country:", defaultValue: "" });
  });
});
