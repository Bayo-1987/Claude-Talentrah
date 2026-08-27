/**
 * SelectField's placeholder, and why it never appeared.
 *
 * The component always rendered `<option value="" disabled>` first — but a
 * browser SKIPS a disabled option when nothing is selected and lands on the
 * first real one. So the field arrived pre-answered, and `required` was
 * satisfied by a choice the person never made.
 *
 * That is not cosmetic. On /contact every untouched submission read "General
 * question"; on /feedback an idea would be filed as a bug. Both are silent —
 * the form succeeds, with the wrong answer.
 *
 * The fix is a default `defaultValue=""`, applied ONLY when the caller states
 * neither `value` nor `defaultValue`. That distinction is the part worth
 * pinning: signup passes `defaultValue={fields.country}` and the tracker
 * passes `"saved"`, and overriding either would be the same bug pointing the
 * other way.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectField } from "@/components/ui/select-field";

const OPTIONS = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "An idea" },
] as const;

/** The option React marks selected in server markup. */
function selectedValue(html: string): string | null {
  const match = html.match(/<option[^>]*value="([^"]*)"[^>]*selected/);
  return match ? match[1] : null;
}

describe("a field the caller has not pre-answered starts empty", () => {
  it("selects the placeholder, not the first real option", () => {
    const html = renderToStaticMarkup(
      <SelectField label="What's this about?" name="category" options={OPTIONS} required />,
    );
    expect(selectedValue(html)).toBe("");
    expect(selectedValue(html)).not.toBe("bug");
  });

  it("still renders the placeholder text", () => {
    const html = renderToStaticMarkup(
      <SelectField label="Topic" name="topic" options={OPTIONS} placeholder="Pick one…" />,
    );
    expect(html).toContain("Pick one…");
  });

  it("keeps the placeholder disabled, so it cannot be chosen back", () => {
    const html = renderToStaticMarkup(<SelectField label="T" name="t" options={OPTIONS} />);
    expect(html).toMatch(/<option[^>]*value=""[^>]*disabled/);
  });
});

describe("a caller that states a selection keeps it", () => {
  it("honours an explicit defaultValue", () => {
    const html = renderToStaticMarkup(
      <SelectField label="Stage" name="stage" options={OPTIONS} defaultValue="idea" />,
    );
    // The tracker's manual-entry form does exactly this with "saved".
    expect(selectedValue(html)).toBe("idea");
  });

  it("honours an explicit empty defaultValue without fighting it", () => {
    // Signup passes defaultValue={fields.country}, which starts as "" — which
    // is why signup was already correct before this change.
    const html = renderToStaticMarkup(
      <SelectField label="Country" name="country" options={OPTIONS} defaultValue="" />,
    );
    expect(selectedValue(html)).toBe("");
  });

  it("does not force a defaultValue onto a controlled select", () => {
    // Passing both `value` and `defaultValue` is a React warning and, worse,
    // would silently ignore the caller's own state.
    const html = renderToStaticMarkup(
      <SelectField label="T" name="t" options={OPTIONS} value="idea" onChange={() => {}} />,
    );
    expect(selectedValue(html)).toBe("idea");
  });
});

describe("bare-string options still work", () => {
  it("takes the same shape the older callers use", () => {
    // /contact passes CONTACT_TOPICS, a readonly string[].
    const html = renderToStaticMarkup(
      <SelectField label="Topic" name="topic" options={["General question", "Other"]} required />,
    );
    expect(selectedValue(html)).toBe("");
    expect(html).toContain("General question");
  });
});
