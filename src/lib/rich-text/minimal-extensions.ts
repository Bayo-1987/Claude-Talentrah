import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { Bold } from "@tiptap/extension-bold";
import { Italic } from "@tiptap/extension-italic";
import { History } from "@tiptap/extension-history";
import type { AnyExtension } from "@tiptap/core";

/**
 * send-370/371/373 — bold and italic only, and nothing else: no Heading,
 * List, Blockquote, HorizontalRule, HardBreak, Link or Autolink. This is
 * deliberately narrower than `employer/markdown-editor/extensions.ts`'s
 * `MARKDOWN_EDITOR_EXTENSIONS`, not a configured-down variant of it — every
 * consumer of this set (resume summary/bullets, a DecisionForm rejection
 * note, a screening answer) explicitly has no grammar for any of those
 * constructs, so there is no toolbar button that could ever produce one and
 * no `tight`-attribute round-trip bookkeeping needed either (see
 * minimal-document.ts's own header). No HardBreak, on purpose: Enter always
 * starts a new top-level paragraph here — there is no separate "soft line
 * break" concept in this grammar, matching send-373's own ask for "plain
 * paragraph breaks" and send-370 Part B's "one paragraph = one bullet"
 * mapping (a stray Shift+Enter can't produce a line TipTap encodes as
 * something other than a paragraph boundary).
 */
export const MINIMAL_MARKDOWN_EXTENSIONS: AnyExtension[] = [Document, Text, Paragraph, Bold, Italic, History];
