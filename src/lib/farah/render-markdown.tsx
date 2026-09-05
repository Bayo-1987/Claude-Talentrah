import { Fragment, type ReactNode } from "react";

/**
 * Renders Farah's replies as a small, explicitly-limited subset of markdown:
 * bold, italic, unordered/ordered lists, and paragraph breaks. Nothing else.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * The panel used to put the model's raw reply straight into a `<p>` with no
 * parsing at all — `**Making a pivot?**` rendered with the asterisks visible,
 * and a numbered list ran together as one paragraph. The model reliably
 * produces bold, italic and lists because that's how it's prompted to
 * structure advice; the fix is to render the subset it actually uses, not to
 * pull in a general-purpose renderer for content nobody controls.
 *
 * ── WHY NOT A MARKDOWN LIBRARY, AND WHY NOT dangerouslySetInnerHTML ────────
 *
 * This is UNTRUSTED MODEL OUTPUT rendered directly into a signed-in user's
 * session. A general markdown library's job is to support the whole
 * spec — raw HTML passthrough, arbitrary link targets, images — which is
 * exactly the surface this must not have. Building to React ELEMENTS rather
 * than an HTML string means there is no `innerHTML` assignment anywhere in
 * this path for a crafted reply to land in: a `<script>` tag typed into a
 * message is just the literal characters `<script>` as a text node, the same
 * way any other unsupported construct is — never parsed, never dropped
 * silently, always visible as what it literally is.
 *
 * ── WHAT COUNTS AS "OUTSIDE THE SUBSET" ────────────────────────────────────
 *
 * Links, images, headings, code spans, blockquotes, raw HTML — none of these
 * have a parser branch here, which means their source characters (`[`, `#`,
 * `` ` ``, `<`, ...) pass straight through `renderInline` as plain text. A
 * `[Click here](javascript:alert(1))` reply renders as that literal string,
 * not a clickable anything — there is no code path in this file that ever
 * constructs an `<a>`.
 */

/** A `* item` or `- item` marker: the marker, a space, then content. Not `*text*` (no space) — that's italic. */
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
/** A `1. item` marker — digits, a literal dot, a space, then content. */
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;

type Block = { kind: "paragraph"; text: string } | { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(content: string): Block[] {
  const lines = content.split(/\r\n|\r|\n/);
  const blocks: Block[] = [];
  let paragraphLines: string[] = [];

  function flushParagraph() {
    const text = paragraphLines.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphLines = [];
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      flushParagraph();
      i++;
      continue;
    }

    const unordered = line.match(UNORDERED_ITEM);
    const ordered = unordered ? null : line.match(ORDERED_ITEM);

    if (unordered || ordered) {
      flushParagraph();
      const pattern = unordered ? UNORDERED_ITEM : ORDERED_ITEM;
      const items: string[] = [(unordered ?? ordered)![1]];
      i++;
      while (i < lines.length) {
        const next = lines[i].match(pattern);
        if (!next) break;
        items.push(next[1]);
        i++;
      }
      blocks.push({ kind: "list", ordered: !!ordered, items });
      continue;
    }

    paragraphLines.push(line);
    i++;
  }
  flushParagraph();

  return blocks;
}

/**
 * Bold and italic only, checked in that order at every position so `**` is
 * never mistaken for two adjacent italic markers. Deliberately
 * non-recursive — content captured inside a match is rendered as plain text
 * even if it contains its own `*`, which is the "explicitly-limited" half of
 * the brief: nested emphasis is a real markdown feature this does not claim
 * to support.
 */
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const match = INLINE.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) nodes.push(remaining.slice(0, match.index));

    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[2]}</em>);
    } else {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[3]}</em>);
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return nodes;
}

/**
 * The face every block shares — the same classes the panel's `<p>` carried
 * before this existed, so a plain one-paragraph reply looks pixel-identical
 * to today. Lists inherit it rather than getting their own face: a bullet
 * list is still a Farah reply, not a different kind of content.
 */
const FARAH_TEXT = "font-display text-[13.5px] italic leading-relaxed text-ink-soft";

export function renderFarahMarkdown(content: string): ReactNode {
  const blocks = parseBlocks(content);

  // A reply with no parseable block (blank, or whitespace-only) falls back
  // to the plain string — never nothing, and never a crash on empty input.
  if (blocks.length === 0) return content;

  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i} className={FARAH_TEXT}>
            {renderInline(block.text, `p${i}`)}
          </p>
        ) : (
          <Fragment key={i}>
            {block.ordered ? (
              <ol className={`${FARAH_TEXT} list-decimal pl-4`}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul className={`${FARAH_TEXT} list-disc pl-4`}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `l${i}-${j}`)}</li>
                ))}
              </ul>
            )}
          </Fragment>
        ),
      )}
    </div>
  );
}
