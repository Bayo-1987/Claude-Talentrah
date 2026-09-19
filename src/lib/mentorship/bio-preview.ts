/**
 * send-369 — a mentor bio can now contain `**bold**`/`*italic*` (see
 * rich-markdown-editor.tsx's `toolbar="minimal"`), but the directory list
 * card still shows it `line-clamp-3`'d as a one-paragraph excerpt — the same
 * "short preview vs. full render" split `stripMarkdownToPlainText`
 * (src/lib/jobs/extract-jd.ts) already establishes for the job feed card:
 * a clamped excerpt is the wrong register for rich formatting, so the card
 * strips to plain text and only the full profile page renders the rich
 * version.
 *
 * Not that same function, because its own doc comment scopes it deliberately
 * narrow to what `stripHtml` emits (bold + bullets, no italic) — a bio typed
 * directly through this toolbar can contain italic too, and never contains
 * bullets at all (the toolbar excludes lists), so the marker set differs.
 * Order matters: bold (`**`) must strip before italic (`*`), or a bold run's
 * own asterisks get eaten by the italic pass first.
 */
export function stripBioMarkdownToPlainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
}
