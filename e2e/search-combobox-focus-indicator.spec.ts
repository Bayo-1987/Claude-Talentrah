import { test, expect } from "./fixtures/authed";

/**
 * send-381 (WCAG 2.4.7) — search-combobox.tsx's job search input had
 * `outline-none` with no focus replacement, so tabbing into it produced
 * zero visible change for a keyboard user.
 *
 * Extracted from send-427's investigation of the stale
 * `fix/a11y-focus-contrast-landmarks` branch: every other fix on that
 * branch (focus indicators on three other fields, IconButton/FilterChip
 * contrast, landmark regions site-wide) was already independently fixed on
 * `main` via PR #482 and its send-381 follow-up commits — this input was
 * the one field neither of those touched, confirmed by grepping current
 * `main` and finding it still had bare `outline-none` with nothing else.
 *
 * The assertion reads a real computed style, not a className string, and
 * specifically pins `outlineStyle` to the literal value `"solid"` rather
 * than "changed at all": Tailwind v4's `outline-none` sets a shared
 * `--tw-outline-style: none` custom property, and `outline-2`/`outline-rust`
 * alone just re-read that same (still "none") variable rather than
 * overriding it — outline-color and outline-width both visibly changed on
 * the broken version while the outline itself stayed invisible, which is
 * exactly the failure mode a looser "after !== before" check would have
 * missed. `focus:outline-solid` is what resets the variable back to a real
 * style.
 */
test("the search bar input's own outline goes from none to a real solid outline on focus", async ({
  authedPage,
}) => {
  await authedPage.goto("/jobs");
  const input = authedPage.locator("#job-search");
  await input.waitFor();
  const readOutline = () =>
    input.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, color: s.outlineColor, width: s.outlineWidth };
    });

  const before = await readOutline();
  await input.focus();
  const after = await readOutline();

  expect(before.style, "sanity: the field must start with no outline").toBe("none");
  expect(after.style, "MONEY BUG target: focus:outline-solid is what actually makes the outline render").toBe(
    "solid",
  );
  expect(after.width).toBe("2px");
  expect(after.color).not.toBe(before.color);
});
