import { Extension, markInputRule, markPasteRule } from "@tiptap/core";

/**
 * send-367 — live "typing/pasting a raw https://... becomes link-styled in
 * the editor" behaviour, driven by the SAME bare-URL shape render-markdown.tsx
 * already recognizes at display time (a literal `https?://` prefix only,
 * excluding the delimiters a URL is normally followed by in prose) —
 * deliberately NOT TipTap/linkify's own broader autolink detection, which
 * would otherwise sometimes link text this app's real renderer would not
 * (see extensions.ts's own comment on `autolink: false`).
 *
 * Only ever applies the `link` mark to a text run that IS the URL — never a
 * separate label — matching document.ts's serializer, which refuses to
 * emit an href for any link mark whose text disagrees with it.
 */
const BARE_URL = /(https?:\/\/[^\s<>"'()[\]]+)/;
const BARE_URL_TRIGGERED = new RegExp(`${BARE_URL.source}(\\s)$`);
const BARE_URL_GLOBAL = new RegExp(BARE_URL.source, "g");

export const Autolink = Extension.create({
  name: "autolink",

  addInputRules() {
    return [
      markInputRule({
        find: BARE_URL_TRIGGERED,
        type: this.editor.schema.marks.link,
        getAttributes: (match) => ({ href: match[1] }),
      }),
    ];
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: BARE_URL_GLOBAL,
        type: this.editor.schema.marks.link,
        getAttributes: (match) => ({ href: match[0] }),
      }),
    ];
  },
});
