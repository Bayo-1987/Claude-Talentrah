import { Fragment, type ReactNode } from "react";

/**
 * Renders Farah's replies as a small, explicitly-limited subset of markdown:
 * bold, italic, unordered/ordered lists, paragraph breaks, headings,
 * horizontal rules, and blockquotes. Nothing else.
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
 * ── HEADINGS/RULES/BLOCKQUOTES WERE ADDED, NOT PROMPTED AWAY ───────────────
 *
 * A system-prompt paragraph asking the model not to use `#`/`---`/`>` was
 * tried first and falsified live, twice, on production: naming the forbidden
 * constructs in prose did not stop the model from reaching for them whenever
 * it was asked for a "framework," "playbook," or "90-day sprint schedule."
 * This codebase already knows better than to rely on a caller remembering a
 * rule when a mechanism can enforce it instead (the `match_scores`
 * invalidation trigger, the atomic credit-spend function, the terminal-
 * `hired` trigger are the same reasoning). Headings, rules and blockquotes
 * carry none of the actual risk this file's comment below lumped them in
 * with — that risk is specifically raw HTML, links and images — so the fix
 * is to support them as real, safe elements instead of asking the model to
 * avoid them. Tables are still out of scope: a markdown table cannot render
 * legibly in a 280px sidebar column regardless of whether the syntax parses
 * correctly, so the system prompt asks for lists instead and this file has
 * no table parser to fall back on if that's ignored.
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
 * silently, always visible as what it literally is. Headings/rules/
 * blockquotes are parsed to block-level React elements exactly the way lists
 * already are, with their inline text still escaped through the same
 * `renderInline` — no new path was added that could ever construct an `<a>`
 * or an `<img>`.
 *
 * ── WHAT COUNTS AS "OUTSIDE THE SUBSET" ────────────────────────────────────
 *
 * Bracket-syntax links, images, code spans, tables, raw HTML — none of these
 * have a parser branch here, which means their source characters (`[`,
 * `` ` ``, `|`, `<`, ...) pass straight through `renderInline` as plain
 * text. A `[Click here](javascript:alert(1))` reply renders as that literal
 * string, not a clickable anything, for EITHER caller of this file — there
 * is no code path anywhere here that parses `[label](url)` syntax into an
 * `<a>`.
 *
 * ── THE ONE EXCEPTION, AND WHY IT DOES NOT WEAKEN THE ABOVE ────────────────
 *
 * `renderJobDescriptionMarkdown` (not `renderFarahMarkdown`) also autolinks a
 * BARE `http(s)://` url with no bracket syntax at all — added because a real
 * posting can contain one (`https://lnkd.in/...`) and leaving it dead plain
 * text is a worse outcome than the risk, which is materially different from
 * a bracketed link: a bare URL's visible text IS its destination, so there is
 * no separate label to lie about the way `[trustworthy text](evil-url)`
 * does. See INLINE_WITH_URL and MarkdownFace's `link` field below for the
 * mechanism and for why Farah's own renderer is structurally unable to reach
 * it — the paragraph above (no `<a>` from bracket syntax, ever, for either
 * caller) still holds exactly as stated.
 */

/** A `* item` or `- item` marker: the marker, a space, then content. Not `*text*` (no space) — that's italic. */
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
/** A `1. item` marker — digits, a literal dot, a space, then content. */
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;
/** `#` through `######`, a space, then content — every heading level renders identically, just bold text at one modestly larger size. */
const HEADING = /^#{1,6}\s+(.*)$/;
/** Three or more bare hyphens and nothing else. Not `- - -` or any other hr variant — the model's own output only ever used bare `---`. */
const RULE = /^-{3,}$/;
/** A `> ` marker, optionally followed by content (`>` alone is a valid empty quote line). */
const QUOTE_LINE = /^>\s?(.*)$/;

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "heading"; text: string }
  | { kind: "rule" }
  | { kind: "quote"; text: string };

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
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", text: heading[1] });
      i++;
      continue;
    }

    if (RULE.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
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
      blocks.push({ kind: "quote", text: quoteLines.join(" ").trim() });
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

/**
 * The same three groups, plus a fourth: a BARE url, http(s) only, no bracket
 * or parenthesis syntax at all.
 *
 * WHY BARE URLS ARE A DIFFERENT THREAT SHAPE THAN LINK SYNTAX, AND WHY THAT IS
 * WHAT MAKES THIS SAFE TO ADD. A bracketed `[label](url)` link lets the
 * visible text lie about the destination — that is the entire reason this
 * file has never had a parser branch for `[`/`(` at all (see the file header).
 * A bare URL has no separate label: what is rendered as the link text IS the
 * href, character for character, so there is nothing left to spoof. Only the
 * literal `https?://` prefix makes this recognizable at all, which is why the
 * scheme itself must never be widened into an allowlist or generalized to a
 * protocol-relative (`//`) or bare-domain (`example.com/x`) form — those have
 * no fixed prefix to anchor on, and accepting them is how a caller could get
 * tricked into treating an arbitrary string as a link. Deliberately narrower
 * than a real autolinker for exactly that reason: a posting that writes
 * "visit lnkd.in/xyz" with no scheme stays plain text.
 *
 * The character class excludes the delimiters a URL is likely to be
 * followed by in prose (`<>"')]` and whitespace) so a URL inside existing
 * markdown-link syntax, a quoted attribute, or a parenthetical never eats
 * past its own boundary. It does NOT exclude `.,!?;:` — those are legal
 * inside a real URL's path/query — so a trailing one is trimmed off after
 * the match instead (see trimTrailingUrlPunctuation below); this is the
 * standard trade-off every plain-text autolinker makes.
 */
const INLINE_WITH_URL = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|(\bhttps?:\/\/[^\s<>"'\)\]]+)/;

/**
 * Sentence punctuation right after a URL ("...see https://x.com/a. Next
 * sentence.") is not part of the address; `)` and `]` are not in this list
 * because INLINE_WITH_URL's character class already excludes them from the
 * match entirely — they can never reach here.
 */
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/;

function renderInline(
  text: string,
  keyPrefix: string,
  opts?: { autoLinkUrls?: boolean; linkClassName?: string },
): ReactNode[] {
  const pattern = opts?.autoLinkUrls ? INLINE_WITH_URL : INLINE;
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }

    if (match.index > 0) nodes.push(remaining.slice(0, match.index));

    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-${key++}`}>{match[1]}</strong>);
      remaining = remaining.slice(match.index + match[0].length);
    } else if (match[2] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[2]}</em>);
      remaining = remaining.slice(match.index + match[0].length);
    } else if (match[3] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-${key++}`}>{match[3]}</em>);
      remaining = remaining.slice(match.index + match[0].length);
    } else {
      // match[4]: a bare URL — only reachable when opts.autoLinkUrls is
      // true, which only JOB_DESCRIPTION_FACE's presence of `link` turns on
      // (see MarkdownFace below). Farah's face has no `link` field, so
      // there is no code path by which a model reply reaches this branch.
      const rawUrl = match[4]!;
      const url = rawUrl.replace(TRAILING_URL_PUNCTUATION, "");
      if (url.length === 0) {
        // Degenerate: nothing but scheme + punctuation (e.g. "https://.").
        // Not a real URL — render the untrimmed text literally rather than
        // link to an empty-path href.
        nodes.push(rawUrl);
        remaining = remaining.slice(match.index + rawUrl.length);
      } else {
        nodes.push(
          <a
            key={`${keyPrefix}-${key++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={opts?.linkClassName}
          >
            {url}
          </a>,
        );
        // Only the TRIMMED length is consumed — trailing punctuation stays
        // in `remaining` to be emitted as plain text on the next pass.
        remaining = remaining.slice(match.index + url.length);
      }
    }
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
/** A heading is just bold text at a modestly larger size — this is a 280px sidebar, not a document, so no real `<h1>`-scale type. */
const FARAH_HEADING = "font-display text-[15px] font-semibold not-italic leading-snug text-ink-soft";
/** Matches farah-panel.tsx's own dashed section divider — a rule is a divider, not a document `<hr>`. */
const FARAH_RULE = "my-0.5 border-t border-dashed border-line";
/** Same face as every other block; the border/indent is the only thing that marks it as quoted. */
const FARAH_QUOTE = `${FARAH_TEXT} border-l-2 border-line pl-3`;

/**
 * The set of classes a block-kind needs — pulled out so the SAME parse/render
 * engine (parseBlocks + renderInline, the whole reason this file is safe
 * against `<a>`/`<img>`/raw HTML) can serve a second caller with a different
 * visual face, instead of a second renderer being written for it.
 */
interface MarkdownFace {
  text: string;
  heading: string;
  rule: string;
  quote: string;
  /**
   * Class for a bare-URL autolink. PRESENCE of this field is what turns on
   * autolinking in renderInline — not a separate boolean threaded in by the
   * caller. FARAH_FACE below has no `link` field at all, so there is no
   * value that could accidentally make Farah's untrusted-model-output path
   * construct an `<a>`; only literally adding a string here would. See
   * renderMarkdownBlocks for where this is read.
   */
  link?: string;
}

// No `link` field — see MarkdownFace's own comment on why that omission,
// not a boolean, is what keeps Farah's renderer structurally incapable of
// ever autolinking untrusted model output.
const FARAH_FACE: MarkdownFace = { text: FARAH_TEXT, heading: FARAH_HEADING, rule: FARAH_RULE, quote: FARAH_QUOTE };

function renderMarkdownBlocks(content: string, face: MarkdownFace): ReactNode {
  const blocks = parseBlocks(content);

  // No parseable block (blank, or whitespace-only) falls back to the plain
  // string — never nothing, and never a crash on empty input.
  if (blocks.length === 0) return content;

  // Derived once from the face, not passed in by the caller — see
  // MarkdownFace's `link` field comment for why that is the safety
  // property, not just a convenience.
  const inlineOpts = face.link ? { autoLinkUrls: true, linkClassName: face.link } : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "paragraph":
            return (
              <p key={i} className={face.text}>
                {renderInline(block.text, `p${i}`, inlineOpts)}
              </p>
            );
          case "heading":
            return (
              <p key={i} className={face.heading}>
                {renderInline(block.text, `h${i}`, inlineOpts)}
              </p>
            );
          case "rule":
            return <hr key={i} className={face.rule} />;
          case "quote":
            return (
              <p key={i} className={face.quote}>
                {renderInline(block.text, `q${i}`, inlineOpts)}
              </p>
            );
          case "list":
            return (
              <Fragment key={i}>
                {block.ordered ? (
                  <ol className={`${face.text} list-decimal pl-4`}>
                    {block.items.map((item, j) => (
                      <li key={j}>{renderInline(item, `l${i}-${j}`, inlineOpts)}</li>
                    ))}
                  </ol>
                ) : (
                  <ul className={`${face.text} list-disc pl-4`}>
                    {block.items.map((item, j) => (
                      <li key={j}>{renderInline(item, `l${i}-${j}`, inlineOpts)}</li>
                    ))}
                  </ul>
                )}
              </Fragment>
            );
        }
      })}
    </div>
  );
}

export function renderFarahMarkdown(content: string): ReactNode {
  return renderMarkdownBlocks(content, FARAH_FACE);
}

/**
 * Same parser, same safety guarantee (no `<a>`, no `<img>`, no
 * `dangerouslySetInnerHTML` — see this file's header), a different face.
 *
 * Job descriptions are not Farah's voice: CLAUDE.md reserves italic
 * display serif for quiet/secondary asides, and a full job description is the
 * main content of its page, not an aside. This exists because
 * `stripHtml` (src/lib/jobs/extract-jd.ts) now converts ATS HTML into this
 * same bold/bullet/paragraph markdown subset instead of flattening it to
 * bare whitespace — rendering that subset through a raw `whitespace-pre-line`
 * text dump would show the literal `**`/`-` characters instead of the
 * structure they encode.
 */
const JOB_DESCRIPTION_FACE: MarkdownFace = {
  text: "text-[15px] leading-relaxed text-ink-soft",
  heading: "text-[15px] font-semibold leading-relaxed text-ink-soft",
  rule: "my-1 border-t border-line",
  quote: "text-[15px] leading-relaxed text-ink-soft border-l-2 border-line pl-3",
  // Same coral-link treatment as the scholarship page's own official-source
  // link (src/app/(app)/scholarships/[id]/page.tsx) — one link style for
  // one concept, not a bespoke one invented here.
  link: "text-coral underline underline-offset-2 hover:text-coral-hover",
};

export function renderJobDescriptionMarkdown(content: string): ReactNode {
  return renderMarkdownBlocks(content, JOB_DESCRIPTION_FACE);
}
