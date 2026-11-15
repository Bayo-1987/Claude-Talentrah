const MAX_LINK_LENGTH = 500;

/**
 * A notification's link is used only when it is a same-origin PATH: it starts with a single "/", has no scheme, no second slash or backslash right after it (which a browser reads as another host), and no
 * whitespace or control character anywhere. Anything else returns null: the item is still shown, without a link. "/" alone is dropped too (nothing to open).
 */
export function safeInternalPath(link: unknown): string | null {
  if (typeof link !== "string") return null;
  if (link.length < 2 || link.length > MAX_LINK_LENGTH) return null;
  if (link[0] !== "/" || link[1] === "/" || link[1] === "\\") return null;
  if (/[\s\u0000-\u001f\u007f\\]/.test(link)) return null;
  return link;
}
