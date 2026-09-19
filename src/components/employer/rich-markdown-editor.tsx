"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { MARKDOWN_EDITOR_EXTENSIONS } from "@/lib/employer/markdown-editor/extensions";
import { markdownToDoc, docToMarkdown } from "@/lib/employer/markdown-editor/document";
import { sanitizePastedHtml } from "@/lib/employer/markdown-editor/paste-sanitize";
import { cn } from "@/lib/cn";

/** ≥40×40 hit target, same rule every other interactive element on this app follows. Pressed state doubles as the "this formatting is currently on" indicator. */
const TOOLBAR_BUTTON =
  "flex min-h-10 min-w-10 items-center justify-center border-[1.5px] border-ink px-2.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust aria-[pressed=true]:bg-ink aria-[pressed=true]:text-paper";

/**
 * send-367 — replaces the plain `<textarea>` + `MarkdownToolbar` combination
 * (job-posting-form.tsx's job description field, assessment-editor.tsx's
 * instructions field) with a real WYSIWYG editor: live bold text, live
 * bullets, no visible `**`/`-` characters while typing, and a paste handler
 * that actually converts rich clipboard content instead of flattening it to
 * one run-together line.
 *
 * ── THE ONE RULE THAT MAKES THIS SAFE ────────────────────────────────────
 *
 * `job_postings.description` / `job_posting_assessments.instructions` keep
 * storing exactly the same plain markdown-subset string they always have —
 * this component NEVER submits TipTap's own HTML export. The hidden input
 * below always carries `docToMarkdown(editor.getJSON())`, walking the
 * editor's own document model through a dedicated serializer that matches
 * `render-markdown.tsx`'s grammar exactly (see document.ts's own header).
 * Nothing downstream — the database column, `renderJobDescriptionMarkdown`,
 * `extractStructuredJd`, full-text search — knows or cares that a rich
 * editor produced this string rather than a plain textarea.
 *
 * Toolbar scope is deliberately exactly what render-markdown.tsx's grammar
 * supports and nothing more — no underline, color, font, alignment, tables,
 * or link/image insertion. See extensions.ts's own header for why each is
 * excluded, not just unbuilt.
 *
 * ── THE IMPERATIVE HANDLE (send-368) ────────────────────────────────────────
 *
 * `RichMarkdownEditorHandle.setMarkdown` exists for exactly one caller so
 * far: job-posting-form.tsx's "Draft with Farah" button, which needs to
 * REPLACE this field's content with a generated draft — something no prop
 * on this component could do, since `defaultValue` is read only once at
 * mount (the same reason NewJobForm remounts the whole form on a URL
 * import, via `formKey`, rather than trying to update `defaultValue` after
 * the fact). A full form remount is wrong here specifically because
 * Draft-with-Farah must not wipe title/location/anything else the employer
 * already typed — only this one field's content should change. `setContent`
 * emits TipTap's own update event by default, which already runs through
 * the exact same `onUpdate` handler below that a real keystroke would (sync
 * the hidden input, clear the required-error state, call `onTextChange`) —
 * nothing here duplicates that sync logic a second time.
 *
 * ── toolbar="minimal" (send-369) ────────────────────────────────────────────
 *
 * Narrows the exposed buttons to bold/italic only, for short-register fields
 * like a mentor bio that shouldn't invite headings/lists/quotes/rules — a
 * toolbar-only restriction, same "toolbar scope ≠ parser scope" split as
 * above: `MARKDOWN_EDITOR_EXTENSIONS` and the underlying `parseBlocks`
 * grammar are unchanged, so a document already containing those constructs
 * (e.g. from before a field was narrowed) still loads and round-trips
 * correctly, it just can't be newly authored from the toolbar.
 */
export interface RichMarkdownEditorHandle {
  setMarkdown: (markdown: string) => void;
}

export const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, {
  id: string;
  /**
   * Omit when a parent embeds the serialized markdown into its own payload
   * instead of submitting this field directly (assessment-editor.tsx's
   * `jobPostingAssessment` JSON field, via `onTextChange`) — no hidden
   * input is rendered in that case, so nothing here can accidentally
   * double-submit or collide with the parent's own form field name.
   */
  name?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  minHeightClassName?: string;
  /** "minimal" = bold/italic only (autolink is always on regardless, see extensions.ts). */
  toolbar?: "full" | "minimal";
  onTextChange?: (markdown: string) => void;
}>(function RichMarkdownEditor(
  { id, name, label, defaultValue, placeholder, required, minHeightClassName = "min-h-[280px]", toolbar = "full", onTextChange },
  ref,
) {
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const labelId = `${id}-label`;
  // Native `required` on a `type="hidden"` input is not user-visibly
  // enforced (a hidden element can't receive focus, so the browser has
  // nothing to point a validation bubble at) — this is the same missing-
  // required-feedback problem the original visible `<textarea required>`
  // never had. A local, inline error message on submit-while-empty is the
  // equivalent feedback for this field specifically.
  const [showRequiredError, setShowRequiredError] = useState(false);

  const editor = useEditor({
    extensions: MARKDOWN_EDITOR_EXTENSIONS,
    content: markdownToDoc(defaultValue ?? ""),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        // A real, visible <label> (below) carries this now — see that
        // element's own comment on why aria-labelledby replaces aria-label
        // rather than sitting alongside it (a screen reader would
        // otherwise announce the same text twice).
        "aria-labelledby": labelId,
        class: cn(
          // The literal minHeightClassName value, not `min-h-[inherit]`.
          // `inherit` only ever pulls from this element's IMMEDIATE DOM
          // parent (TipTap's own `.h-full` EditorContent wrapper, which
          // has no min-height of its own), so it always resolved to
          // nothing — the visible box collapsed to one empty line
          // regardless of what the outer wrapper two levels up reserved.
          // Applying the real class directly here means an override (e.g.
          // assessment-editor.tsx's own 160px) is honored on the actual
          // bordered box, not just on an ancestor nothing reads from.
          minHeightClassName,
          "border-[1.5px] border-t-0 border-ink bg-card px-3.5 py-2.5 font-body text-[15px] leading-[1.65] text-ink outline-none focus:border-rust [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft [&_hr]:my-2 [&_hr]:border-line [&_h1]:text-[15px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:text-[15px] [&_h3]:font-semibold [&_a]:text-rust [&_a]:underline [&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-ink-soft [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        ),
        "data-placeholder": placeholder ?? "",
      },
      transformPastedHTML: sanitizePastedHtml,
    },
    onUpdate: ({ editor: e }) => {
      const markdown = docToMarkdown(e.getJSON());
      if (hiddenInputRef.current) hiddenInputRef.current.value = markdown;
      if (markdown.trim()) setShowRequiredError(false);
      onTextChange?.(markdown);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      setMarkdown: (markdown: string) => {
        editor?.commands.setContent(markdownToDoc(markdown));
      },
    }),
    [editor],
  );

  // Keeps the hidden input's initial value derived from the SAME
  // deserialize -> serialize path the editor's own content went through
  // (rather than the raw `defaultValue` string verbatim) — so a posting
  // whose stored string was never re-saved through this editor still
  // submits identically to what re-opening and immediately saving it WOULD
  // produce, since that is genuinely what the editor now holds.
  useEffect(() => {
    if (editor && hiddenInputRef.current) {
      hiddenInputRef.current.value = docToMarkdown(editor.getJSON());
    }
  }, [editor]);

  useEffect(() => {
    if (!required) return;
    const form = wrapperRef.current?.closest("form");
    if (!form) return;
    const handleSubmit = (e: SubmitEvent) => {
      if (!hiddenInputRef.current?.value.trim()) {
        e.preventDefault();
        setShowRequiredError(true);
        editor?.chain().focus().run();
      }
    };
    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, [required, editor]);

  if (!editor) return null;

  return (
    <div ref={wrapperRef} className="flex flex-col gap-1.5">
      {/*
        A real, visible element — TextField's own exact visual treatment
        (font-body text-[13px] font-semibold text-ink-soft) — where before
        `label` only ever reached an aria-label (screen-reader-only) and
        the post-submit "X is required" error text, leaving a sighted user
        filling out the form with no on-screen indication of what this box
        is at all. The editable region isn't a native input `htmlFor` can
        target, so this pairs with `aria-labelledby` on it instead of
        `<label htmlFor>` — and the editable div's own `aria-label` was
        removed so the label isn't announced twice.
      */}
      <label id={labelId} className="font-body text-[13px] font-semibold text-ink-soft">
        {label}
      </label>
      <div
        role="toolbar"
        // Deliberately NOT `${label} formatting` — Playwright's (and most
        // screen readers') accessible-name matching is substring-based, so
        // an aria-label containing the field's own label verbatim makes
        // `getByLabel(label)` ambiguous between the toolbar and the actual
        // editable field it sits above. Screen-reader context (this toolbar
        // is the element immediately before the labeled textbox in reading
        // order) already conveys which field it formats.
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
        {toolbar === "full" && (
          <>
            <button
              type="button"
              aria-label="Heading"
              aria-pressed={editor.isActive("heading")}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={TOOLBAR_BUTTON}
            >
              H
            </button>
            <button
              type="button"
              aria-label="Bulleted list"
              aria-pressed={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={TOOLBAR_BUTTON}
            >
              •—
            </button>
            <button
              type="button"
              aria-label="Numbered list"
              aria-pressed={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={TOOLBAR_BUTTON}
            >
              1.
            </button>
            <button
              type="button"
              aria-label="Quote"
              aria-pressed={editor.isActive("blockquote")}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={TOOLBAR_BUTTON}
            >
              &ldquo;
            </button>
            <button
              type="button"
              aria-label="Horizontal rule"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              className={TOOLBAR_BUTTON}
            >
              —
            </button>
          </>
        )}
      </div>

      {/*
        No min-height class here any more — it lives on the editable div
        itself now (editorProps.attributes.class, above), which is the
        element `min-h-[inherit]` was always meant to reach. Keeping a
        second copy here too would just be a second place to fall out of
        sync with minHeightClassName if a future caller only updated one
        of the two.
      */}
      <EditorContent editor={editor} />

      {showRequiredError && (
        <p className="font-body text-[12.5px] text-rust">{label} is required.</p>
      )}

      <input ref={hiddenInputRef} type="hidden" name={name} />
    </div>
  );
});
