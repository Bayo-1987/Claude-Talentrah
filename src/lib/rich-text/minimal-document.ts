import { INLINE, splitMarkdownParagraphs } from "@/lib/farah/render-markdown";

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
 */

interface JSONMark {
  type: string;
}

export interface MinimalJSONNode {
  type: string;
  content?: MinimalJSONNode[];
  marks?: JSONMark[];
  text?: string;
}

function parseInlineToNodes(text: string): MinimalJSONNode[] {
  const nodes: MinimalJSONNode[] = [];
  let remaining = text;

  const pushText = (value: string, marks?: JSONMark[]) => {
    if (value.length === 0) return;
    nodes.push(marks && marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value });
  };

  while (remaining.length > 0) {
    const match = INLINE.exec(remaining);
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
    } else {
      pushText(match[3]!, [{ type: "italic" }]);
      remaining = remaining.slice(match.index + match[0].length);
    }
  }

  return nodes;
}

function inlineToMarkdown(content: MinimalJSONNode[] | undefined): string {
  if (!content) return "";
  let out = "";
  for (const node of content) {
    if (node.type !== "text") continue;
    const text = node.text ?? "";
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
export function minimalParagraphsToDoc(paragraphs: string[]): MinimalJSONNode {
  const content =
    paragraphs.length > 0
      ? paragraphs.map((p) => ({ type: "paragraph", content: parseInlineToNodes(p) }))
      : [{ type: "paragraph" }];
  return { type: "doc", content };
}

export function minimalDocToParagraphs(doc: MinimalJSONNode): string[] {
  return (doc.content ?? []).map((block) => inlineToMarkdown(block.content).trim());
}

/** Loads a stored string field. `""` becomes a single empty paragraph, same as TipTap's own empty-doc requirement. */
export function minimalMarkdownToDoc(markdown: string): MinimalJSONNode {
  return minimalParagraphsToDoc(splitMarkdownParagraphs(markdown));
}

/** The inverse — blank-line-joins non-empty paragraphs back into one stored string. */
export function minimalDocToMarkdown(doc: MinimalJSONNode): string {
  return minimalDocToParagraphs(doc)
    .filter((p) => p.length > 0)
    .join("\n\n");
}
