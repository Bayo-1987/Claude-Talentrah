import { INLINE, INLINE_WITH_URL, splitMarkdownParagraphs } from "@/lib/farah/render-markdown";

/**
 * send-370/371/373 — the two-way bridge between a plain string field
 * (`resumes.structured_content.summary`, a DecisionForm rejection note, a
 * screening answer) and the minimal TipTap editor's own JSON document
 * model. Deliberately a SEPARATE, much smaller module than
 * `employer/markdown-editor/document.ts` rather than a parameterized
 * variant of it — that file's `scanRawBlocks`/`rawBlockToNode` exist to
 * round-trip heading/list/rule/quote byte-for-byte, none of which this
 * grammar has at all, and threading an "only some block kinds are legal"
 * flag through that machinery would risk regressing the already-shipped,
 * already-tested job-description editor for no benefit to either side.
 *
 * The only construct here is a paragraph, one per blank-line-separated
 * chunk of the stored string (`splitMarkdownParagraphs`, render-markdown.tsx
 * — the SAME split `renderMarkdownParagraphs` renders with, so what a
 * reader sees as one paragraph is exactly what round-trips as one editor
 * paragraph). Inline marks reuse the plain `INLINE` regex (bold/italic
 * only) — never `INLINE_WITH_URL` — because none of this grammar's
 * consumers want autolink: send-371's own spec calls its grammar "smaller
 * even than mentor bio's," and send-370/373 never asked for it either.
 *
 * Mentor bio (send-369) IS the one exception — its own spec explicitly
 * wants a bare-URL portfolio/LinkedIn link — so every function below takes
 * an optional `{ linkable: true }` to switch the parse pattern to
 * `INLINE_WITH_URL` and represent a matched URL as a `link` mark. This is
 * additive, not a second grammar: every existing non-bio caller omits the
 * option and is byte-for-byte unaffected. The serializer's `href === text`
 * check runs unconditionally regardless of the flag — the same
 * "hyperlink with a misleading label can never round-trip" safety property
 * `employer/markdown-editor/document.ts` already established, reused here
 * rather than re-derived, since a link mark can only ever exist if this
 * module itself (or the editor's own live Autolink extension, which sets
 * href to the exact text it wraps) created one.
 */

interface JSONMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface MinimalJSONNode {
  type: string;
  content?: MinimalJSONNode[];
  marks?: JSONMark[];
  text?: string;
}

function parseInlineToNodes(text: string, linkable = false): MinimalJSONNode[] {
  const nodes: MinimalJSONNode[] = [];
  let remaining = text;
  const pattern = linkable ? INLINE_WITH_URL : INLINE;

  const pushText = (value: string, marks?: JSONMark[]) => {
    if (value.length === 0) return;
    nodes.push(marks && marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value });
  };

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match) {
      pushText(remaining);
      break;
    }

    if (match.index > 0) pushText(remaining.slice(0, match.index));

    if (match[1] !== undefined) {
      pushText(match[1], [{ type: "bold" }]);
      remaining = remaining.slice(match.index + match[0].length);
    } else if (match[2] !== undefined) {
      pushText(match[2], [{ type: "italic" }]);
      remaining = remaining.slice(match.index + match[0].length);
    } else if (match[3] !== undefined) {
      pushText(match[3], [{ type: "italic" }]);
      remaining = remaining.slice(match.index + match[0].length);
    } else {
      // match[4]: a bare URL, only reachable when `linkable` selected
      // INLINE_WITH_URL — mirrors employer/markdown-editor/document.ts's
      // own parseInlineToNodes exactly (href always equals the visible
      // text, which is what makes the serializer's guard below safe).
      const url = match[4]!;
      pushText(url, [{ type: "link", attrs: { href: url } }]);
      remaining = remaining.slice(match.index + match[0].length);
    }
  }

  return nodes;
}

/**
 * THE SECURITY-LOAD-BEARING LINE IS THE href !== text CHECK — identical
 * reasoning and identical guard to employer/markdown-editor/document.ts's
 * own inlineToMarkdown. A `link` mark here can only ever be created by
 * parseInlineToNodes above (linkable mode) or the editor's own live
 * Autolink extension, both of which always set href to the exact text they
 * wrap; if anything else ever produced a mark whose href disagrees with
 * its visible text, this refuses to emit the href, only the plain text.
 */
function inlineToMarkdown(content: MinimalJSONNode[] | undefined): string {
  if (!content) return "";
  let out = "";
  for (const node of content) {
    if (node.type !== "text") continue;
    const text = node.text ?? "";
    const linkMark = node.marks?.find((m) => m.type === "link");
    if (linkMark && linkMark.attrs?.href === text) {
      out += text;
      continue;
    }
    const bold = node.marks?.some((m) => m.type === "bold");
    const italic = node.marks?.some((m) => m.type === "italic");
    if (bold) out += `**${text}**`;
    else if (italic) out += `*${text}*`;
    else out += text;
  }
  return out;
}

/**
 * One string per top-level paragraph, in order — the array-native shape
 * send-370 Part B's "one paragraph = one bullet" mapping needs directly,
 * with no markdown-string join/split step (and its own fragility) in
 * between. String-field callers (`minimalMarkdownToDoc`/`minimalDocToMarkdown`
 * below) are built on top of these two, not the other way round.
 */
export function minimalParagraphsToDoc(paragraphs: string[], opts?: { linkable?: boolean }): MinimalJSONNode {
  const content =
    paragraphs.length > 0
      ? paragraphs.map((p) => ({ type: "paragraph", content: parseInlineToNodes(p, opts?.linkable) }))
      : [{ type: "paragraph" }];
  return { type: "doc", content };
}

export function minimalDocToParagraphs(doc: MinimalJSONNode): string[] {
  return (doc.content ?? []).map((block) => inlineToMarkdown(block.content).trim());
}

/** Loads a stored string field. `""` becomes a single empty paragraph, same as TipTap's own empty-doc requirement. */
export function minimalMarkdownToDoc(markdown: string, opts?: { linkable?: boolean }): MinimalJSONNode {
  return minimalParagraphsToDoc(splitMarkdownParagraphs(markdown), opts);
}

/** The inverse — blank-line-joins non-empty paragraphs back into one stored string. */
export function minimalDocToMarkdown(doc: MinimalJSONNode): string {
  return minimalDocToParagraphs(doc)
    .filter((p) => p.length > 0)
    .join("\n\n");
}
