/** The postings that will be closed when the only member of an organisation deletes their account, by title: the person sees them before and after. */
export function ClosingPostingsList({ postings }: { postings: Array<{ id: string; title: string; organization: string }> }) {
  if (postings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-b border-line pb-3">
      <p className="font-body text-[13.5px] text-ink">
        You are the only member of your organisation, so its open postings will be closed. The organisation and the applications it has received are kept.
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 font-body text-[13.5px] text-ink-soft">
        {postings.map((p) => (
          <li key={p.id}>
            {p.title} <span className="font-display italic">({p.organization})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
