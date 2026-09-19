"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { MINIMAL_MARKDOWN_EXTENSIONS, MINIMAL_MARKDOWN_EXTENSIONS_LINKABLE } from "@/lib/rich-text/minimal-extensions";
import { minimalMarkdownToDoc, minimalDocToMarkdown } from "@/lib/rich-text/minimal-document";
import { sanitizePastedHtml } from "@/lib/employer/markdown-editor/paste-sanitize";
import { cn } from "@/lib/cn";

/** Same ≥40×40 hit-target rule as RichMarkdownEditor's own toolbar buttons. */
const TOOLBAR_BUTTON =
  "flex min-h-10 min-w-10 items-center justify-center border-[1.5px] border-ink px-2.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust aria-[pressed=true]:bg-ink aria-[pressed=true]:text-paper";

/**
 * send-370/371/373 — a real WYSIWYG editor for fields whose grammar is
 * ONLY bold/italic plus paragraph breaks: resume summary, a DecisionForm
 * rejection note, a screening answer. Deliberately a separate, smaller
 * sibling of `employer/rich-markdown-editor.tsx` rather than that
 * component reconfigured — same reasoning as `minimal-extensions.ts`'s own
 * header: every consumer here has no grammar for heading/list/quote/rule/
 * link at all, so there is no toolbar for them and no risk of silently
 * regressing the already-shipped job-description editor by threading a
 * grammar flag through its extension/serializer plumbing.
 *
 * Same "never submit TipTap's own HTML" rule as RichMarkdownEditor: the
 * hidden input always carries `minimalDocToMarkdown(editor.getJSON())`, a
 * plain bold/italic markdown-subset string. Nothing downstream needs to
 * know a rich editor produced it.
 *
 * `linkable` (send-369, default false) is the one opt-in escape hatch: bio
 * is the sole consumer whose own spec wants a bare-https:// autolink. See
 * minimal-extensions.ts's own header for why this is additive rather than
 * a second grammar.
 */
export function MinimalRichEditor({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  required,
  minHeightClassName = "min-h-[120px]",
  linkable = false,
  onTextChange,
}: {
  id: string;
  /** Omit when a parent embeds the serialized markdown into its own payload via onTextChange instead of submitting this field directly. */
  name?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  minHeightClassName?: string;
  /** send-369 — mentor bio only: adds a bare-https:// autolink (see minimal-extensions.ts's own header). Every other caller omits this. */
  linkable?: boolean;
  onTextChange?: (markdown: string) => void;
}) {
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const labelId = `${id}-label`;
  const [showRequiredError, setShowRequiredError] = useState(false);

  const editor = useEditor({
    extensions: linkable ? MINIMAL_MARKDOWN_EXTENSIONS_LINKABLE : MINIMAL_MARKDOWN_EXTENSIONS,
    content: minimalMarkdownToDoc(defaultValue ?? "", { linkable }),
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
          linkable && "[&_a]:text-rust [&_a]:underline",
        ),
        "data-placeholder": placeholder ?? "",
      },
      // Only needed when Link is registered at all — see paste-sanitize.ts's
      // own header on why a non-linkable schema has no equivalent risk to
      // guard against (ProseMirror can't create a mark type its schema
      // never registered, autolink or not).
      ...(linkable ? { transformPastedHTML: sanitizePastedHtml } : {}),
    },
    onUpdate: ({ editor: e }) => {
      const markdown = minimalDocToMarkdown(e.getJSON());
      if (hiddenInputRef.current) hiddenInputRef.current.value = markdown;
      if (markdown.trim()) setShowRequiredError(false);
      onTextChange?.(markdown);
    },
  });

  useEffect(() => {
    if (editor && hiddenInputRef.current) {
      hiddenInputRef.current.value = minimalDocToMarkdown(editor.getJSON());
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

      {showRequiredError && (
        <p className="font-body text-[12.5px] text-rust">{label} is required.</p>
      )}

      <input ref={hiddenInputRef} type="hidden" name={name} />
    </div>
  );
}
