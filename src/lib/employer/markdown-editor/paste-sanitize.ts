/**
 * send-367 — runs BEFORE ProseMirror ever parses pasted HTML into a
 * document (wired as `editorProps.transformPastedHTML` in
 * rich-markdown-editor.tsx), so nothing outside the exact whitelist below
 * ever reaches the editor's own schema-driven parser at all.
 *
 * ── WHY THIS EXISTS ALONGSIDE A SCHEMA THAT ALREADY CAN'T REPRESENT MOST OF
 *    THIS ─────────────────────────────────────────────────────────────────
 *
 * ProseMirror can only ever create nodes/marks for types actually registered
 * in the editor's schema (extensions.ts) — an `<img>`, a `<table>`, a
 * `<u>`, a colored `<span style="color:...">` all have no matching node/mark
 * type, so the schema-driven parse alone already can't construct them. This
 * sanitizer is defense in depth for two things the schema CANNOT rule out by
 * itself:
 *
 *   1. `<a href>` — the Link mark IS registered (it has to be, for the bare-
 *      URL autolink behaviour render-markdown.tsx already renders), so a
 *      pasted anchor whose visible text differs from its href would
 *      otherwise parse straight into a Link mark carrying BOTH — a
 *      "hyperlink with a misleading label" smuggled through paste, which is
 *      exactly the threat shape render-markdown.tsx's own header explains
 *      bare-URL autolinking is safe specifically BECAUSE it can't happen.
 *      Unwrapping every `<a>` to its plain text content here means the only
 *      way a Link mark can ever exist afterward is via the editor's own
 *      autolink-as-you-type pass finding literal `https?://` text — which
 *      always sets href to the exact text it wraps (see extensions.ts and
 *      document.ts's own matching serializer guard).
 *   2. `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` — these are
 *      removed ENTIRELY, tag and content both. Everything else not in the
 *      whitelist is UNWRAPPED (its tag dropped, its children kept) rather
 *      than removed, because "a font-colored span" or a "table cell" still
 *      carries real text a candidate/recruiter would expect to survive as
 *      plain text — only markup shaped to inject or mislead is dropped
 *      wholesale.
 *
 * Runs in the browser only (DOMParser) — this is paste-time authoring UX,
 * never a server round trip.
 */

/** Tags kept as themselves — everything else is either unwrapped (children kept as plain text/inline content) or, for STRIP_ENTIRELY, removed along with its content. */
const ALLOWED_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "B",
  "EM",
  "I",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "HR",
]);

/**
 * A `<div>` maps to `<p>` rather than being unwrapped — Word/Docs/Gmail
 * paste HTML commonly uses one `<div>` per visual paragraph, and unwrapping
 * it entirely would merge consecutive paragraphs' text into one run with no
 * boundary between them at all.
 */
const REMAP_TO_P = new Set(["DIV"]);

/** Tag + all its content removed outright — never surfaced as plain text either. */
const STRIP_ENTIRELY = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT"]);

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    // Comments and anything else carry no content worth keeping.
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (STRIP_ENTIRELY.has(tag)) return null;

  const children = Array.from(el.childNodes)
    .map((child) => sanitizeNode(child, doc))
    .filter((n): n is Node => n !== null);

  if (REMAP_TO_P.has(tag)) {
    const p = doc.createElement("P");
    children.forEach((child) => p.appendChild(child));
    return p;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap: this element's OWN tag — and for <a>, its href; for <span>,
    // any color/font/underline styling; for <table>/<tr>/<td>, the grid
    // structure itself — never survives. Only whatever text its children
    // already resolved to does. <img> has no useful text children at all,
    // so it contributes nothing.
    const fragment = doc.createDocumentFragment();
    children.forEach((child) => fragment.appendChild(child));
    return fragment;
  }

  const clean = doc.createElement(tag);
  children.forEach((child) => clean.appendChild(child));
  return clean;
}

export function sanitizePastedHtml(html: string): string {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const output = parsed.implementation.createHTMLDocument("");
  const body = output.body;

  Array.from(parsed.body.childNodes).forEach((child) => {
    const sanitized = sanitizeNode(child, output);
    if (sanitized) body.appendChild(sanitized);
  });

  return body.innerHTML;
}
