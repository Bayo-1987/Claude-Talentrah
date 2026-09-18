import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { Heading } from "@tiptap/extension-heading";
import { BulletList } from "@tiptap/extension-bullet-list";
import { OrderedList } from "@tiptap/extension-ordered-list";
import { ListItem } from "@tiptap/extension-list-item";
import { Blockquote } from "@tiptap/extension-blockquote";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { HardBreak } from "@tiptap/extension-hard-break";
import { History } from "@tiptap/extension-history";
import { Link } from "@tiptap/extension-link";
import type { AnyExtension } from "@tiptap/core";
import { Autolink } from "./autolink";

/**
 * send-367 — the exact node/mark set `render-markdown.tsx`'s grammar
 * supports, and NOTHING ELSE. Assembled from individual `@tiptap/extension-*`
 * packages rather than `@tiptap/starter-kit`, deliberately: StarterKit also
 * bundles Code, CodeBlock and Strike, none of which this markdown subset has
 * an encoding for — including them would let an employer apply a style that
 * silently vanishes the moment the posting is saved and reloaded, exactly
 * the failure mode this file exists to rule out for underline/color/
 * font-family (see this feature's own scope notes).
 *
 * `tight` (an internal-only, `rendered: false` attribute added to every
 * block-level node below) is not part of the markdown grammar itself — it's
 * how `document.ts`'s serializer knows whether the ORIGINAL stored string
 * had a blank line before this block or not, which is real, common
 * production content (a caption line directly followed by a list, no blank
 * line) and would otherwise get silently reformatted on every save. See
 * document.ts's own header for the full reasoning.
 */
function withTight<T extends AnyExtension>(extension: T): T {
  return extension.extend({
    addAttributes(this: { parent?: () => Record<string, unknown> }) {
      return {
        ...this.parent?.(),
        tight: { default: false, rendered: false },
      };
    },
  }) as T;
}

export const MARKDOWN_EDITOR_EXTENSIONS: AnyExtension[] = [
  Document,
  Text,
  withTight(Paragraph),
  Bold,
  Italic,
  // `level` already exists on Heading — extended only to add `tight` on top
  // of it, not to redefine level handling.
  withTight(Heading.configure({ levels: [1, 2, 3, 4, 5, 6] })),
  withTight(
    BulletList.extend({
      addAttributes(this: { parent?: () => Record<string, unknown> }) {
        return {
          ...this.parent?.(),
          // Which literal marker (`-` or `*`) the ORIGINAL stored string
          // used — both render identically, but a real posting's own
          // choice must round-trip exactly. See document.ts's matching
          // comment on why this needs tracking at all.
          marker: { default: "-", rendered: false },
        };
      },
    }),
  ),
  withTight(OrderedList),
  ListItem,
  withTight(Blockquote),
  withTight(
    HorizontalRule.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          // How many hyphens the ORIGINAL rule used (RULE only requires
          // 3+) — preserved so a real posting's own long `-----...-----`
          // divider round-trips exactly rather than being narrowed to a
          // fixed `---` on every save.
          dashCount: { default: 3, rendered: false },
        };
      },
    }),
  ),
  HardBreak,
  History,
  /*
   * autolink: false, deliberately — TipTap/linkifyjs's own bare-URL
   * detection uses a different, broader pattern than render-markdown.tsx's
   * INLINE_WITH_URL (which this app already has a documented reason to keep
   * narrow: only a literal `https?://` prefix, see that file's own header).
   * A second, slightly different URL-recognizer here would mean the editor
   * sometimes links text the real renderer wouldn't, or vice versa —
   * exactly the kind of drift this feature's whole design exists to avoid.
   * Live-as-you-type autolinking is implemented once, in rich-markdown-
   * editor.tsx, driven by that same exported regex.
   *
   * openOnClick: false — this is an authoring surface, not the published
   * page; clicking a link while writing a job description should place the
   * cursor, not navigate away from the editor.
   */
  Link.configure({ autolink: false, openOnClick: false }),
  Autolink,
];
