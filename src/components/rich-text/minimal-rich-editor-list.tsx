"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { MINIMAL_MARKDOWN_EXTENSIONS } from "@/lib/rich-text/minimal-extensions";
import { minimalParagraphsToDoc, minimalDocToParagraphs } from "@/lib/rich-text/minimal-document";
import { cn } from "@/lib/cn";

/** Same ≥40×40 hit-target rule as MinimalRichEditor's own toolbar buttons. */
const TOOLBAR_BUTTON =
  "flex min-h-10 min-w-10 items-center justify-center border-[1.5px] border-ink px-2.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust aria-[pressed=true]:bg-ink aria-[pressed=true]:text-paper";

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * send-370 Part B — the array-native sibling of `MinimalRichEditor`, for a
 * field that is genuinely a `string[]` (resume experience bullets), not a
 * single string. Built directly on `minimalParagraphsToDoc`/
 * `minimalDocToParagraphs` (`minimal-document.ts`'s own "array-native path")
 * rather than routing through a joined-then-resplit markdown string: the
 * risk that design was chosen to avoid — a stray Enter/Backspace silently
 * merging two bullets into one or splitting one into two without the array
 * updating in step — only disappears if the editor's own paragraph
 * boundaries ARE the array boundaries, with no join/split step a keystroke
 * could desynchronize from.
 *
 * ── WHY THIS ONE IS RE-SYNCED ON PROP CHANGE, NOT UNCONTROLLED LIKE ITS
 *    SIBLINGS ──────────────────────────────────────────────────────────────
 *
 * `MinimalRichEditor`/`RichMarkdownEditor` read their initial content once
 * and never again — fine for a single field with no reason to change out
 * from under the editor except an explicit remount (a `key` bump). Resume
 * experience entries are different: resume-editor.tsx's own experience
 * list is drag-reorderable, keyed by array INDEX
 * (`content.experience.map((entry, i) => <BorderedCard key={i}>`), so
 * reordering does NOT remount a card — React reuses the same component
 * instance at that index with new props. An uncontrolled child would keep
 * showing the PREVIOUS occupant's bullets after a drag; Farah's bullet
 * rewrite has the identical shape (replaces one entry's bullets from
 * outside any keystroke here). The `useEffect` below re-syncs the editor's
 * document whenever the incoming `paragraphs` prop genuinely disagrees
 * with what the editor itself currently holds — comparing against the
 * editor's OWN live serialization (not a stale copy of the last prop)
 * is what keeps this from also firing right back on the editor's own
 * `onUpdate` -> `onParagraphsChange` -> new `paragraphs` prop round trip,
 * which would otherwise reset the cursor to the start on every keystroke.
 */
export function MinimalRichEditorList({
  id,
  label,
  paragraphs,
  onParagraphsChange,
  placeholder,
  minHeightClassName = "min-h-[96px]",
}: {
  id: string;
  label: string;
  paragraphs: string[];
  onParagraphsChange: (paragraphs: string[]) => void;
  placeholder?: string;
  minHeightClassName?: string;
}) {
  const labelId = `${id}-label`;

  const editor = useEditor({
    extensions: MINIMAL_MARKDOWN_EXTENSIONS,
    content: minimalParagraphsToDoc(paragraphs),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        class: cn(
          minHeightClassName,
          "border-[1.5px] border-t-0 border-ink bg-card px-3.5 py-2.5 font-body text-[15px] leading-[1.65] text-ink outline-none focus:border-rust [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-ink-soft [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        ),
        "data-placeholder": placeholder ?? "",
      },
    },
    onUpdate: ({ editor: e }) => {
      onParagraphsChange(minimalDocToParagraphs(e.getJSON()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    // Trailing blank paragraph (the user just pressed Enter and hasn't
    // typed the next bullet yet) is real, live editor state that
    // `onParagraphsChange`'s own caller (bulletsPatch) already filters out
    // before it ever reaches `paragraphs` — comparing non-blank-only on
    // both sides is what keeps that in-progress empty line from being
    // wiped out by a sync this same keystroke's own onUpdate triggered.
    const current = minimalDocToParagraphs(editor.getJSON()).filter((p) => p.length > 0);
    if (!arraysEqual(current, paragraphs)) {
      editor.commands.setContent(minimalParagraphsToDoc(paragraphs));
    }
  }, [paragraphs, editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <label id={labelId} className="font-body text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap gap-1.5 border-[1.5px] border-ink bg-card p-1.5"
      >
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={TOOLBAR_BUTTON}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={cn(TOOLBAR_BUTTON, "italic")}
        >
          i
        </button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
