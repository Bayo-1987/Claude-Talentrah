import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/**
 * Markdown → HTML for blog bodies.
 *
 * ── WHY NOT next-mdx-remote, WHICH THIS REPLACES ──────────────────────────
 *
 * MDX compiles to executable JSX. While posts were .mdx files in the repo that
 * was fine — the content came through code review like any other source file.
 * Now the body comes out of a database row, and compiling a database string as
 * code turns "an admin account was compromised" into "arbitrary code runs on
 * our server" rather than "someone defaced a blog post".
 *
 * Nothing was using MDX features to pay for that: all four migrated posts are
 * plain Markdown — checked, not assumed — with `##` headings, `-` bullets and
 * `**bold**`, and not a single JSX element, import, or component between them.
 *
 * ── WHY A LIBRARY AND NOT FORTY LINES OF REGEX ────────────────────────────
 *
 * A hand-rolled renderer for those three constructs is genuinely small, and it
 * would mean owning the escaping — which is the same failure class the MDX
 * decision above is avoiding, just wearing a smaller hat. It also goes stale
 * the first time a post wants a link, a code block or a table.
 *
 * ── SANITISED ANYWAY, THOUGH ONLY ADMINS CAN WRITE ────────────────────────
 *
 * `marked` passes raw HTML through by default: a body containing a <script>
 * tag emits a <script> tag. That is defensible for trusted input and this is
 * trusted input, but it makes "an admin typo" and "an admin account takeover"
 * the same event. The allowlist below closes it for the cost of one call.
 *
 * The allowlist is exactly the tags the editorial styling has rules for, plus
 * the ones a writer will reach for next. Anything else is stripped rather than
 * escaped, so an unexpected tag disappears instead of appearing as literal
 * angle brackets in the middle of a paragraph.
 */

/** Tailwind classes per element, mirroring what mdxComponents rendered before. */
const CLASS_MAP: Record<string, string> = {
  h2: "mt-2 text-[22px] text-ink",
  h3: "mt-1 text-[18px] text-ink",
  p: "text-[15.5px] leading-[1.75] text-ink-soft",
  a: "text-rust underline underline-offset-2",
  ul: "flex flex-col gap-2 text-[15.5px] leading-[1.75] text-ink-soft",
  ol: "flex flex-col gap-2 text-[15.5px] leading-[1.75] text-ink-soft",
  li: "ml-5 list-disc",
  strong: "text-ink",
  blockquote: "border-l-2 border-line pl-4 text-[15.5px] italic text-ink-soft",
  code: "bg-paper-alt px-1 text-[14px]",
  pre: "overflow-x-auto border border-line bg-paper-alt p-4 text-[13.5px]",
};

export function renderMarkdown(body: string): string {
  const raw = marked.parse(body, { async: false, gfm: true, breaks: false }) as string;

  return sanitizeHtml(raw, {
    allowedTags: [
      "h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "a",
      "code", "pre", "blockquote", "hr", "br",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    /*
     * `class` must be allowlisted or the styling below is silently discarded:
     * transformTags adds the attribute and the attribute filter then removes
     * it, leaving correct HTML with no classes on it. Caught by diffing the
     * rendered output against the pre-migration snapshot — the element
     * sequence and text matched exactly and every class was empty.
     */
    allowedAttributes: {
      ...Object.fromEntries(Object.keys(CLASS_MAP).map((t) => [t, ["class"]])),
      a: ["href", "title", "class"],
    },
    // Link targets are restricted to schemes that cannot execute: `javascript:`
    // in a markdown link is the oldest XSS in the format.
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      /*
       * The classes are attached HERE rather than by a wrapper selector, so the
       * emitted HTML matches what mdxComponents produced element for element.
       * That is what makes "the migrated posts render identically" a diff
       * anyone can run rather than a judgement call.
       */
      ...Object.fromEntries(
        Object.entries(CLASS_MAP)
          .filter(([tag]) => tag !== "a")
          .map(([tag, cls]) => [
            tag,
            // merge = FALSE: our class replaces whatever was on the element
            // rather than joining it, so an author cannot smuggle styling in
            // through a raw <p class="..."> in the Markdown body.
            sanitizeHtml.simpleTransform(tag, { class: cls }, false),
          ]),
      ),
      /*
       * Links need their own transform: a blanket replace would drop `href`
       * along with the author's classes, turning every link into plain text.
       */
      a: (_tag, attribs) => ({
        tagName: "a",
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          class: CLASS_MAP.a!,
        },
      }),
      // Anything reaching h1 in a body would compete with the page's own title.
      h1: sanitizeHtml.simpleTransform("h2", { class: CLASS_MAP.h2! }),
    },
  });
}
