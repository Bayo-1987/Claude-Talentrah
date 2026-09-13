/**
 * The search box's italic scoping (src/components/jobs/search-combobox.tsx).
 *
 * `italic` used to sit unscoped on the input's own class, so it applied to
 * whatever the user actually typed, not just the empty-state placeholder.
 * CLAUDE.md: "Italic display font = quiet/secondary asides (placeholders,
 * captions, taglines)" — a real, active search term is none of those.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchCombobox } from "@/components/jobs/search-combobox";

function inputClassName(html: string): string {
  const match = html.match(/<input[^>]*class="([^"]*)"/);
  if (!match) throw new Error("no <input> with a class attribute found");
  return match[1];
}

describe("the search input's italic scoping", () => {
  it(
    "SABOTAGE-PROOF TARGET: italic is scoped to the placeholder, not the input's own text",
    () => {
      const html = renderToStaticMarkup(<SearchCombobox defaultValue="" index={[]} />);
      const classes = inputClassName(html).split(/\s+/);
      expect(classes).toContain("placeholder:italic");
      // Not present as its own unscoped token — "placeholder:italic" containing
      // the substring "italic" must not make this a false pass.
      expect(classes).not.toContain("italic");
    },
  );

  it("a real typed value still renders through the same (now upright) class", () => {
    const html = renderToStaticMarkup(<SearchCombobox defaultValue="product manager" index={[]} />);
    expect(html).toContain('value="product manager"');
    const classes = inputClassName(html).split(/\s+/);
    expect(classes).not.toContain("italic");
    expect(classes).toContain("text-ink");
  });

  it("placeholder:text-ink-soft is unchanged", () => {
    const html = renderToStaticMarkup(<SearchCombobox defaultValue="" index={[]} />);
    expect(inputClassName(html)).toContain("placeholder:text-ink-soft");
  });
});
