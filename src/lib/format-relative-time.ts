/** The bare relative fragment — "today" / "1 day ago" / "2 weeks ago" — with no leading verb, so a caller can compose it into more than one sentence ("Posted …", "re-verified …"). */
export function relativeDayLabel(isoDate: string, now: number = Date.now()): string {
  const diffMs = now - new Date(isoDate).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 14) return `${diffDays} days ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 8) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.floor(diffDays / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function formatRelativeTime(isoDate: string, now: number = Date.now()): string {
  return `Posted ${relativeDayLabel(isoDate, now)}`;
}
