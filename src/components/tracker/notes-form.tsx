import { updateNotesAction } from "@/lib/applications/tracker-actions";

export function NotesForm({
  applicationId,
  notes,
}: {
  applicationId: string;
  notes: string | null;
}) {
  return (
    <form
      action={updateNotesAction.bind(null, applicationId)}
      className="flex items-start gap-2.5 border-t border-line pt-3"
    >
      <textarea
        name="notes"
        defaultValue={notes ?? ""}
        placeholder="Notes — interview dates, contacts, next steps…"
        rows={1}
        className="min-h-10 w-full flex-1 resize-y border-[1.5px] border-ink bg-card px-3 py-2 font-body text-[13.5px] text-ink outline-none focus:border-rust"
      />
      <button
        type="submit"
        className="inline-flex min-h-10 flex-shrink-0 items-center px-3 font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
      >
        Save
      </button>
    </form>
  );
}
