/**
 * A message typed over several lines is SHOWN over several lines. The panel's own copy of the user's message used to be a plain paragraph, which folds a line break into a space: fine for a one-line box, wrong for a
 * multi-line one (what was typed and what is shown would differ). The text is unchanged (the characters are exactly what was typed); only the way it is laid out preserves the breaks and wraps a long unbroken word.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => null }));
const { FarahPanel } = await import("@/components/app-shell/farah-panel");

const render = (content: string) =>
  renderToStaticMarkup(<FarahPanel firstName="Ada" initialMessages={[{ id: "u1", role: "user", content, created_at: "2026-01-01T00:00:00.000Z" }]} />);
const userParagraph = (html: string) => /<p data-testid="farah-message"[^>]*>[\s\S]*?<\/p>/.exec(html)![0];

describe("the user's own message in the panel", () => {
  const html = render("First line\nSecond line\n\nFourth");
  it("keeps every line break it was typed with (the text itself is unchanged)", () => {
    expect(userParagraph(html)).toContain("First line\nSecond line\n\nFourth");
  });
  it("is laid out to show them: preserved line breaks, and a long word wraps instead of pushing the panel wider", () => {
    expect(userParagraph(html)).toContain("whitespace-pre-wrap");
    expect(userParagraph(html)).toMatch(/break-words|\[overflow-wrap:anywhere\]/);
  });
});
