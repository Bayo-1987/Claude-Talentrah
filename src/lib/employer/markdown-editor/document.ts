import {
  HEADING,
  RULE,
  QUOTE_LINE,
  UNORDERED_ITEM,
  ORDERED_ITEM,
  INLINE_WITH_URL,
  TRAILING_URL_PUNCTUATION,
} from "@/lib/farah/render-markdown";

/**
 * send-367 — the two-way bridge between the stored markdown-subset string
 * (`job_postings.description` / `job_posting_assessments.instructions`,
 * unchanged) and the TipTap rich-text editor's own JSON document model.
 *
 * ── WHY THIS IS NOT JUST "CALL parseBlocks" ──────────────────────────────
 *
 * `parseBlocks` (render-markdown.tsx) already makes every classification
 * decision this needs (is this line a heading, a rule, a quote, a list
 * item, or does it accumulate into a paragraph) — reused here via the SAME
 * exported regexes it's built from, not a second copy of them. What
 * `parseBlocks` does NOT preserve is enough to round-trip byte-for-byte:
 * its own `flushParagraph`/quote handling JOINS a multi-line paragraph or
 * quote into one space-separated string, because that's exactly right for
 * DISPLAY (a reader never needs to know the source had a mid-sentence line
 * break) but wrong for AUTHORING round-trip (re-opening a real production
 * posting like the Fabricator listing — four `\r\n`-joined lines with no
 * blank line between them — and saving with no edits would collapse them
 * to one line if this just used parseBlocks' own `.text` field).
 *
 * So this file re-implements the SAME line-by-line scan, using the SAME
 * regexes in the SAME order — never a different classification rule than
 * parseBlocks would apply to the same input — but keeps each paragraph's
 * and quote's ORIGINAL per-line array instead of joining early, and encodes
 * that as TipTap hardBreak nodes so the serializer can reconstruct the
 * exact original line breaks.
 *
 * ── THE DELIBERATE, DOCUMENTED NORMALIZATIONS — FOUR, NOT ZERO ────────────
 *
 * Line endings (`\r\n`/`\r`) become `\n`; italic written as `_word_`
 * re-emits as `*word*`; a bulleted list's own `*`/`-` marker (both matched
 * identically by UNORDERED_ITEM) IS preserved exactly via a `marker` node
 * attr — the one exception that turned out cheap enough to just do
 * properly rather than normalize. The fourth, found empirically while
 * building the paste-conversion e2e coverage rather than assumed up front:
 * leading/trailing whitespace at a BLOCK's own edges (`blockToMarkdown`'s
 * own `.trim()` calls) is stripped on any round trip. Real clipboard HTML
 * from Word/Docs/Gmail can leave a stray whitespace text node at a pasted
 * block's boundary that has nothing to do with the content itself; without
 * trimming, a real paste reproduced exactly the founder's "About the role"
 * fixture with trailing spaces after every line. This also strips one
 * genuine (if accidental) trailing space found in real production data
 * itself (the Senior Product Manager posting's "...in the trenches. "
 * line) — kept anyway, because a trailing space at a block's edge is
 * invisible to rendering, to re-parsing, and to a reader, exactly like the
 * other three. All four are non-semantic in exactly this sense: nothing
 * about how a posting renders, matches skills, or re-parses can ever tell
 * the difference. Checked directly against this app's own real internal
 * job-description data on production (2026-09-18) before writing this, not
 * assumed: only the one trailing-space example above actually occurs.
 * Tests normalize both sides of every comparison for exactly these four
 * reasons, documented rather than silently glossed over.
 */

// ── Deserialize: markdown string -> TipTap JSON document ───────────────────

type RawBlockKind =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[]; marker: "-" | "*" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "rule"; dashCount: number }
  | { kind: "quote"; lines: string[] };

/**
 * `tight`: true when this block immediately follows the previous one with
 * NO blank line in the original — real, common production content, not an
 * edge case: a plain caption line ("What You'll Do") directly followed by a
 * bulleted list with zero blank lines between them is exactly the shape of
 * a real internal posting checked against production before writing this.
 * parseBlocks' own `.text`/render output does not care about this distinction
 * at all (blank-line count between blocks never affects rendering), but the
 * exact STORED STRING does, so it has to be tracked to round-trip it.
 * Always true for the first block (nothing precedes it to be tight against).
 */
type RawBlock = RawBlockKind & { tight: boolean };

/**
 * Line-by-line scan mirroring `parseBlocks`' own control flow exactly (same
 * checks, same order: blank line flushes the paragraph, then heading, then
 * rule, then a run of `>` lines, then a run of list-item lines, else
 * accumulate into the paragraph) — the difference is what gets kept: raw
 * per-line arrays instead of an early-joined string, and whether a blank
 * line actually separated this block from the previous one (see `tight`
 * above).
 */
function scanRawBlocks(content: string): RawBlock[] {
  const lines = content.split(/\r\n|\r|\n/);
  const blocks: RawBlock[] = [];
  let paragraphLines: string[] = [];
  // Set on encountering a blank line, cleared the moment any block is
  // pushed — this is exactly the fact `tight` needs: was there a blank
  // line since the last block ended, regardless of how many.
  let sawBlankSinceLastBlock = false;

  function push(block: RawBlockKind) {
    blocks.push({ ...block, tight: blocks.length > 0 && !sawBlankSinceLastBlock });
    sawBlankSinceLastBlock = false;
  }

  function flushParagraph() {
    // Same emptiness check as parseBlocks' own flushParagraph (join, trim,
    // only emit if non-blank) — applied to decide WHETHER to emit, not to
    // the content that's actually kept.
    if (paragraphLines.join(" ").trim()) {
      push({ kind: "paragraph", lines: paragraphLines });
    }
    paragraphLines = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      sawBlankSinceLastBlock = true;
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      const hashes = line.match(/^#{1,6}/)![0];
      push({ kind: "heading", level: hashes.length, text: heading[1] });
      i++;
      continue;
    }

    if (RULE.test(trimmed)) {
      flushParagraph();
      push({ kind: "rule", dashCount: trimmed.length });
      i++;
      continue;
    }

    const quoteLine = line.match(QUOTE_LINE);
    if (quoteLine) {
      flushParagraph();
      const quoteLines: string[] = [quoteLine[1]];
      i++;
      while (i < lines.length) {
        const next = lines[i].match(QUOTE_LINE);
        if (!next) break;
        quoteLines.push(next[1]);
        i++;
      }
      push({ kind: "quote", lines: quoteLines });
      continue;
    }

    const unordered = line.match(UNORDERED_ITEM);
    const ordered = unordered ? null : line.match(ORDERED_ITEM);

    if (unordered || ordered) {
      flushParagraph();
      const pattern = unordered ? UNORDERED_ITEM : ORDERED_ITEM;
      // Which literal marker character the ORIGINAL used (`-` or `*`) —
      // UNORDERED_ITEM matches either without distinguishing them, but the
      // exact character has to round-trip, same reasoning as `dashCount`
      // for a rule: both marker choices render identically, so nothing
      // stops an employer's real posting from using either.
      const marker: "-" | "*" = unordered ? (trimmed[0] as "-" | "*") : "-";
      const items: string[] = [(unordered ?? ordered)![1]];
      i++;
      while (i < lines.length) {
        const next = lines[i].match(pattern);
        if (!next) break;
        items.push(next[1]);
        i++;
      }
      push({ kind: "list", ordered: !!ordered, items, marker });
      continue;
    }

    paragraphLines.push(line);
    i++;
  }
  flushParagraph();

  return blocks;
}

interface JSONMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  marks?: JSONMark[];
  text?: string;
}

/**
 * The same inline scan `renderInline` (render-markdown.tsx) performs, over
 * the same `INLINE_WITH_URL` pattern, but building TipTap text nodes
 * instead of React elements. Bold/italic become marks; a bare URL becomes a
 * `link` mark whose href is deliberately always identical to its own text
 * content (see the module header and the serializer below for why that
 * equality is the whole safety property here).
 */
function parseInlineToNodes(text: string): JSONNode[] {
  const nodes: JSONNode[] = [];
  let remaining = text;

  const pushText = (value: string, marks?: JSONMark[]) => {
    if (value.length === 0) return;
    nodes.push(marks && marks.length > 0 ? { type: "text", text: value, marks } : { type: "text", text: value });
  };

  while (remaining.length > 0) {
    const match = INLINE_WITH_URL.exec(remaining);
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
      const rawUrl = match[4]!;
      const url = rawUrl.replace(TRAILING_URL_PUNCTUATION, "");
      if (url.length === 0) {
        pushText(rawUrl);
        remaining = remaining.slice(match.index + rawUrl.length);
      } else {
        pushText(url, [{ type: "link", attrs: { href: url } }]);
        remaining = remaining.slice(match.index + url.length);
      }
    }
  }

  return nodes.length > 0 ? nodes : [];
}

/** A paragraph's or quote's raw line array -> inline content with hardBreak nodes between lines. */
function linesToInlineContent(lines: string[]): JSONNode[] {
  const content: JSONNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...parseInlineToNodes(line));
  });
  // An empty paragraph (blank lines only reach here if flushParagraph's own
  // non-blank check let them through, which it never does — kept for a
  // defensive, never-crash empty case) needs at least no content, which
  // TipTap's schema already allows for a paragraph node.
  return content;
}

function rawBlockToNode(block: RawBlock): JSONNode {
  // `tight` rides on every node's own attrs (rather than a separate parallel
  // array) so it survives however TipTap's own editor state copies/clones
  // nodes internally — an attr is part of the node itself, exactly like
  // heading's `level` or horizontalRule's `dashCount` already are.
  const tight = { tight: block.tight };
  switch (block.kind) {
    case "paragraph":
      return { type: "paragraph", attrs: tight, content: linesToInlineContent(block.lines) };
    case "heading":
      return {
        type: "heading",
        attrs: { level: block.level, ...tight },
        content: parseInlineToNodes(block.text),
      };
    case "rule":
      return { type: "horizontalRule", attrs: { dashCount: block.dashCount, ...tight } };
    case "quote":
      return {
        type: "blockquote",
        attrs: tight,
        content: [{ type: "paragraph", content: linesToInlineContent(block.lines) }],
      };
    case "list":
      return {
        type: block.ordered ? "orderedList" : "bulletList",
        attrs: block.ordered ? tight : { marker: block.marker, ...tight },
        content: block.items.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineToNodes(item) }],
        })),
      };
  }
}

/**
 * Loads an existing stored string into the editor. `""` (a brand-new,
 * untouched field) becomes a single empty paragraph — TipTap's own document
 * schema requires at least one block-level child, the same way an empty
 * `<textarea>` is still a valid, just-empty text field.
 */
export function markdownToDoc(markdown: string): JSONNode {
  const blocks = scanRawBlocks(markdown);
  if (blocks.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  return { type: "doc", content: blocks.map(rawBlockToNode) };
}

// ── Serialize: TipTap JSON document -> markdown string ──────────────────────

/**
 * Walks a run of inline TipTap nodes (text + hardBreak) back to the exact
 * inline markdown syntax `parseInlineToNodes`/`renderInline` both read:
 * `**bold**`, `*italic*` (always this marker on the way out — see the
 * module header on why `_italic_` normalizes rather than round-trips), and
 * a bare URL for a `link` mark WHOSE TEXT EQUALS ITS HREF.
 *
 * THE SECURITY-LOAD-BEARING LINE IS THE href !== text CHECK: a `link` mark
 * can only ever be created by this app's own deserializer or its own
 * autolink-as-you-type behavior, both of which set href to the exact text
 * they wrap — but if anything else (a future extension change, a paste
 * path this file didn't anticipate) ever produced a mark whose href
 * disagrees with its visible text, this refuses to emit the href at all,
 * only the plain text. That is precisely the "hyperlink with a misleading
 * label" case this feature must never smuggle through as something the
 * stored string can represent — see the paste-sanitize module for the
 * complementary guard on the way IN.
 */
function inlineToMarkdown(content: JSONNode[] | undefined): string {
  if (!content) return "";
  let out = "";
  for (const node of content) {
    if (node.type === "hardBreak") {
      out += "\n";
      continue;
    }
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
 * Trailing/leading whitespace on a single markdown LINE is never
 * semantically meaningful in this grammar, and real stored production data
 * never carries it — but a browser's own clipboard HTML serialization can
 * genuinely leave a stray whitespace text node at a block's edge that
 * `sanitizePastedHtml` has no reason to strip (it is not one of the things
 * that changes meaning). Trimmed at exactly the points a markdown line gets
 * emitted, not inside `inlineToMarkdown` itself, so a stored multi-line
 * paragraph's hardBreak-joined INTERNAL lines (real production content,
 * never paste-derived) are untouched — only the whole block's own edges are.
 */
function blockToMarkdown(node: JSONNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content).trim();
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${inlineToMarkdown(node.content).trim()}`;
    }
    case "horizontalRule": {
      const dashCount = typeof node.attrs?.dashCount === "number" ? node.attrs.dashCount : 3;
      return "-".repeat(Math.max(3, dashCount));
    }
    case "blockquote": {
      // A blockquote built by our own deserializer always holds exactly one
      // paragraph (see rawBlockToNode) whose hardBreaks are each one
      // original `>` line — split back into one `> ` per line.
      const inner = (node.content ?? []).map((child) => inlineToMarkdown(child.content)).join("\n");
      return inner
        .split("\n")
        .map((line) => line.trim())
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const marker = typeof node.attrs?.marker === "string" ? node.attrs.marker : "-";
      return (node.content ?? [])
        .map((item, i) => {
          const text = (item.content ?? []).map((child) => inlineToMarkdown(child.content)).join("").trim();
          return ordered ? `${i + 1}. ${text}` : `${marker} ${text}`;
        })
        .join("\n");
    }
    default:
      return "";
  }
}

/**
 * The inverse of `markdownToDoc` — must produce byte-identical output for
 * any document `markdownToDoc` itself produced and that was then saved
 * without edits. This is the property the round-trip test suite checks
 * directly against real production descriptions, not just hand-written
 * fixtures.
 *
 * Joins with a single `\n` (no blank line) when the block's own `tight`
 * attr says the original had none between it and its predecessor — the
 * exact "caption line directly followed by a list" shape a real internal
 * posting uses — and `\n\n` (exactly one blank line) otherwise. Multiple
 * ORIGINAL blank lines between two blocks collapse to exactly one on any
 * round trip through this editor, same documented, non-semantic
 * normalization class as the line-ending and italic-marker cases in this
 * file's own header (parseBlocks itself never distinguished 1 blank line
 * from 3 — both flush a paragraph identically — so nothing about
 * classification, rendering, or re-parsing can tell the difference either).
 */
export function docToMarkdown(doc: JSONNode): string {
  const blocks = doc.content ?? [];
  let out = "";
  blocks.forEach((block, i) => {
    if (i > 0) out += block.attrs?.tight === true ? "\n" : "\n\n";
    out += blockToMarkdown(block);
  });
  return out;
}
