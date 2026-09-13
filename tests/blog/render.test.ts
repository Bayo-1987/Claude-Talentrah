/**
 * Markdown rendering, and the two things it must never do.
 *
 * ── WHY THE CLASSES ARE ASSERTED ──────────────────────────────────────────
 *
 * The four migrated posts had to render identically after moving from MDX to
 * marked, and "identically" was checked by diffing the real rendered HTML
 * against a snapshot taken from live production before the migration. That
 * diff caught a bug nothing else would have: sanitize-html was stripping every
 * class, because transformTags added `class` and allowedAttributes then
 * removed it. The pages were structurally perfect and completely unstyled.
 *
 * These tests hold that shut. If the class map and the attribute allowlist
 * drift apart again, this fails instead of the blog quietly losing its
 * typography.
 *
 * ── WHY SANITISATION IS TESTED THOUGH ONLY ADMINS CAN WRITE ───────────────
 *
 * `marked` passes raw HTML through by default. Trusted input makes that
 * defensible right up until an admin account is compromised, at which point
 * the difference between "defaced a post" and "ran script in every reader's
 * browser" is this allowlist.
 */
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/blog/render";

describe("the editorial classes survive sanitisation", () => {
  it.each([
    ["## Heading", 'class="mt-2 text-[22px] text-ink"'],
    ["### Sub", 'class="mt-1 text-[18px] text-ink"'],
    ["A paragraph.", 'class="text-[15.5px] leading-[1.75] text-ink-soft"'],
    ["**bold**", 'class="text-ink"'],
    ["- item", 'class="ml-5 list-disc"'],
  ])("%s keeps its class", (md, cls) => {
    expect(renderMarkdown(md)).toContain(cls);
  });

  it("gives links their class AND keeps the href", () => {
    // Both halves matter: an earlier draft replaced every attribute, which
    // would have styled links correctly and made them go nowhere.
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('class="text-rust underline underline-offset-2"');
  });
});

describe("what must not survive", () => {
  it("strips a script tag", () => {
    const html = renderMarkdown("Hello\n\n<script>alert(1)</script>\n\nWorld");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips inline event handlers", () => {
    expect(renderMarkdown('<p onclick="steal()">hi</p>')).not.toContain("onclick");
  });

  it("drops a javascript: link target", () => {
    // The oldest XSS in the Markdown format.
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("does not let an author smuggle in their own classes", () => {
    // merge:false on the transform — our class replaces theirs rather than
    // joining, so a body cannot restyle the page around itself.
    const html = renderMarkdown('<p class="fixed inset-0 z-50 bg-ink">covering the page</p>');
    expect(html).not.toContain("fixed inset-0");
    expect(html).toContain('class="text-[15.5px] leading-[1.75] text-ink-soft"');
  });

  it("demotes an h1 so it cannot compete with the page title", () => {
    const html = renderMarkdown("# Shouting");
    expect(html).not.toContain("<h1");
    expect(html).toContain("<h2");
  });
});

describe("the constructs the migrated posts actually use", () => {
  it("renders the exact shape those four posts are made of", () => {
    const html = renderMarkdown("Intro paragraph.\n\n## A heading\n\n- one **bold** item\n- two");
    for (const frag of [
      '<p class="text-[15.5px] leading-[1.75] text-ink-soft">',
      '<h2 class="mt-2 text-[22px] text-ink">',
      '<ul class="flex flex-col gap-2 text-[15.5px] leading-[1.75] text-ink-soft">',
      '<li class="ml-5 list-disc">',
      '<strong class="text-ink">',
    ]) {
      expect(html, `missing ${frag}`).toContain(frag);
    }
  });
});
